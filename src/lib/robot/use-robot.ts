"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { decodeCdrJson } from "./cdr";
import {
  EMPTY_POSE,
  SERVICES,
  type Pose,
  type ProgramStatus,
} from "./commands";
import {
  FOXGLOVE_SUBPROTOCOL,
  decodeMessageData,
  decodeServiceResponse,
  encodeServiceCall,
  type ActivityEvent,
  type Channel,
  type HelloEvent,
  type PresenceEvent,
  type Service,
} from "./protocol";

// The browser's connection to the lab computer.
//
// One socket carries everything: telemetry from ROS, the commands this client
// issues, and — the reason the lab works as a shared instrument — the
// gatekeeper's broadcast of what *other* people are doing. A spectator holds
// exactly the same socket as the operator; the difference is only what the
// gatekeeper lets each of them send.

export type LinkState =
  | "demo"
  | "connecting"
  | "online"
  | "offline"
  | "unauthorized";

/** Telemetry document published by the weblab node (see edge/ros2). */
interface TelemetryDocument {
  connected?: boolean;
  enabled?: boolean | null;
  speed?: number;
  error?: string;
  joints_deg?: number[];
  joints_rad?: number[];
  pose?: Partial<Pose>;
  program?: Partial<ProgramStatus>;
}

export interface Telemetry {
  connected: boolean;
  enabled: boolean | null;
  speed: number;
  error: string;
  jointsDeg: number[];
  jointsRad: number[];
  pose: Pose;
  program: ProgramStatus;
}

const EMPTY_TELEMETRY: Telemetry = {
  connected: false,
  enabled: null,
  speed: 50,
  error: "",
  jointsDeg: [],
  jointsRad: [],
  pose: EMPTY_POSE,
  program: {
    running: false,
    stepIndex: -1,
    stepCount: 0,
    programName: "",
    operatorName: "",
  },
};

const TELEMETRY_TOPIC = "/weblab/telemetry";
const RECONNECT_MS = 4000;
/** Ceiling for the reconnect backoff — how long a recovered lab waits to be
 *  noticed, in the worst case, if nothing wakes the tab first. */
const MAX_RECONNECT_MS = 20_000;
const MAX_ACTIVITY = 100;

const POSE_KEYS: (keyof Pose)[] = ["x", "y", "z", "rx", "ry", "rz"];

function sameNumbers(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/** Value equality over the whole telemetry document. */
function sameTelemetry(a: Telemetry, b: Telemetry): boolean {
  return (
    a.connected === b.connected &&
    a.enabled === b.enabled &&
    a.speed === b.speed &&
    a.error === b.error &&
    sameNumbers(a.jointsDeg, b.jointsDeg) &&
    sameNumbers(a.jointsRad, b.jointsRad) &&
    POSE_KEYS.every((key) => a.pose[key] === b.pose[key]) &&
    a.program.running === b.program.running &&
    a.program.stepIndex === b.program.stepIndex &&
    a.program.stepCount === b.program.stepCount &&
    a.program.programName === b.program.programName &&
    a.program.operatorName === b.program.operatorName
  );
}

export interface RobotConnection {
  link: LinkState;
  telemetry: Telemetry;
  /** Commands issued by anyone on this lab, newest first. */
  activity: ActivityEvent[];
  /** Everyone currently connected to the hardware, as the edge sees it. */
  viewers: number;
  role: string | null;
  /** Last refusal from the gatekeeper, for surfacing in the UI. */
  lastDenial: string | null;
  /** True once the gatekeeper has accepted our lease token. */
  authorizedToDrive: boolean;
  call: (service: string, payload?: unknown) => Promise<boolean>;
  clearDenial: () => void;
}

/**
 * @param controlUrl origin of the lab computer's tunnel, or null for demo mode
 * @param leaseToken current control-lease token, or null when not driving
 */
export function useRobot(
  controlUrl: string | null,
  leaseToken: string | null,
): RobotConnection {
  const [link, setLink] = useState<LinkState>(
    controlUrl ? "connecting" : "demo",
  );
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [viewers, setViewers] = useState(0);
  const [role, setRole] = useState<string | null>(null);
  const [lastDenial, setLastDenial] = useState<string | null>(null);
  const [leaseAccepted, setLeaseAccepted] = useState(false);
  // The edge's acceptance only counts while we still hold a token: dropping the
  // lease must revoke the affordance in the same render, not one effect later.
  const authorizedToDrive = leaseAccepted && Boolean(leaseToken);

  const socketRef = useRef<WebSocket | null>(null);
  const servicesRef = useRef(new Map<string, number>());
  const subscriptionsRef = useRef(new Map<number, string>());
  const pendingRef = useRef(new Map<number, (ok: boolean) => void>());
  const callIdRef = useRef(1);
  const leaseRef = useRef<string | null>(leaseToken);

  // Keep the socket's idea of our lease current without reconnecting: the
  // control heartbeat mints a fresh token every few seconds, and a queued
  // operator who inherits the lease starts driving the moment one arrives.
  useEffect(() => {
    leaseRef.current = leaseToken;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: "lease", token: leaseToken ?? "" }));
    }
  }, [leaseToken]);

  useEffect(() => {
    if (!controlUrl) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    // A lab computer that is switched off stays switched off, and a fixed
    // retry means the page never settles: every few seconds the status pill
    // flips "Conectando… → Sin conexión", the offline banner re-renders, and
    // another session lookup and socket handshake go out. To anyone watching
    // it looks like the page reloading itself on a timer.
    //
    // So: back off, and stop announcing each attempt. The first try says
    // "connecting"; after that the lab is simply offline until it is not.
    function scheduleRetry() {
      if (closed || retry) return;
      const backoff = Math.min(
        RECONNECT_MS * Math.pow(1.5, attempt),
        MAX_RECONNECT_MS,
      );
      attempt += 1;
      // Jitter so a lecture hall coming back online does not reconnect in
      // lockstep and hand the gatekeeper every socket in the same instant.
      const delay = backoff * (0.8 + Math.random() * 0.4);
      retry = setTimeout(() => {
        retry = null;
        void connect();
      }, delay);
    }

    async function connect() {
      if (closed) return;
      // Only the first attempt of a run is worth announcing; a retry that
      // fails the same way as the last one is not news.
      if (attempt === 0) setLink("connecting");

      // The gatekeeper authenticates the socket, not the request, so the token
      // goes in the first payload rather than a header — browsers cannot set
      // headers on a WebSocket upgrade.
      const supabase = createClient();
      const accessToken =
        (await supabase?.auth.getSession())?.data.session?.access_token ?? "";

      const url = `${controlUrl!.replace(/^http/, "ws")}/ws`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url, [FOXGLOVE_SUBPROTOCOL]);
      } catch {
        setLink("offline");
        scheduleRetry();
        return;
      }
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            op: "auth",
            token: accessToken,
            lease: leaseRef.current ?? "",
          }),
        );
      };

      socket.onclose = (event) => {
        socketRef.current = null;
        servicesRef.current.clear();
        subscriptionsRef.current.clear();
        setLeaseAccepted(false);
        if (closed) return;
        // 4401 is the gatekeeper refusing our identity. Retrying in a loop
        // would just hammer it; the user needs to fix their access instead.
        if (event.code === 4401) {
          setLink("unauthorized");
          return;
        }
        setLink("offline");
        scheduleRetry();
      };

      socket.onerror = () => setLink("offline");

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          handleJson(event.data);
        } else {
          handleBinary(event.data as ArrayBuffer);
        }
      };
    }

    function handleJson(raw: string) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      switch (message.op) {
        case "hello": {
          const hello = message as unknown as HelloEvent;
          // Connected and accepted: the next outage starts from a short delay
          // again rather than from wherever the last one left off.
          attempt = 0;
          setLink("online");
          setRole(hello.user.role);
          setViewers(hello.viewers);
          setLeaseAccepted(hello.holdsLease);
          break;
        }
        case "leaseAck": {
          setLeaseAccepted(Boolean(message.holdsLease));
          break;
        }
        case "activity": {
          const eventData = message as unknown as ActivityEvent;
          setActivity((prev) => [eventData, ...prev].slice(0, MAX_ACTIVITY));
          break;
        }
        case "presence": {
          const presence = message as unknown as PresenceEvent;
          setViewers(presence.viewers);
          break;
        }
        case "denied": {
          setLastDenial(String(message.reason ?? "acción no permitida"));
          const callId = message.callId;
          if (typeof callId === "number") {
            pendingRef.current.get(callId)?.(false);
            pendingRef.current.delete(callId);
          }
          break;
        }
        case "advertise": {
          const channels = (message.channels ?? []) as Channel[];
          const wanted = channels.filter((c) => c.topic === TELEMETRY_TOPIC);
          if (wanted.length > 0) subscribe(wanted);
          break;
        }
        case "advertiseServices": {
          for (const service of (message.services ?? []) as Service[]) {
            servicesRef.current.set(service.name, service.id);
          }
          break;
        }
        case "serviceCallFailure": {
          const callId = message.callId;
          if (typeof callId === "number") {
            pendingRef.current.get(callId)?.(false);
            pendingRef.current.delete(callId);
          }
          setLastDenial(String(message.message ?? "el robot rechazó el comando"));
          break;
        }
        default:
          break;
      }
    }

    function subscribe(channels: Channel[]) {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      const subscriptions = channels.map((channel, index) => {
        const id = subscriptionsRef.current.size + index + 1;
        subscriptionsRef.current.set(id, channel.topic);
        return { id, channelId: channel.id };
      });
      socket.send(JSON.stringify({ op: "subscribe", subscriptions }));
    }

    function handleBinary(buffer: ArrayBuffer) {
      const data = decodeMessageData(buffer);
      if (data) {
        if (subscriptionsRef.current.get(data.subscriptionId) !== TELEMETRY_TOPIC) {
          return;
        }
        // decodeMessageData already sliced off the frame header; the remainder
        // is the CDR-encoded std_msgs/String the weblab node publishes.
        const document = decodeCdrJson<TelemetryDocument>(
          buffer.slice(13),
        );
        if (document) applyTelemetry(document);
        return;
      }
      const response = decodeServiceResponse(buffer);
      if (response) {
        pendingRef.current.get(response.callId)?.(true);
        pendingRef.current.delete(response.callId);
      }
    }

    function applyTelemetry(document: TelemetryDocument) {
      setTelemetry((prev) => {
        const next: Telemetry = {
          connected: document.connected ?? prev.connected,
          enabled: document.enabled ?? prev.enabled,
          speed: document.speed ?? prev.speed,
          error: document.error ?? "",
          jointsDeg: document.joints_deg ?? prev.jointsDeg,
          jointsRad: document.joints_rad ?? prev.jointsRad,
          pose: { ...prev.pose, ...(document.pose ?? {}) },
          program: { ...prev.program, ...(document.program ?? {}) },
        };
        // The node publishes at a fixed rate whether or not anything moved. A
        // stationary arm would otherwise hand React a new object several times
        // a second and re-render the whole console for no change at all.
        return sameTelemetry(prev, next) ? prev : next;
      });
    }

    // Backing off is right for a lab that is switched off, and wrong the
    // moment something says it might not be: a tab coming back to the
    // foreground, or a laptop that has just found Wi-Fi again. Both skip the
    // rest of the wait instead of making the user look at "Sin conexión" for
    // another twenty seconds.
    const wake = () => {
      if (closed || document.visibilityState !== "visible") return;
      if (socketRef.current) return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      attempt = 0;
      void connect();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    void connect();
    return () => {
      closed = true;
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [controlUrl]);

  // ── Demo mode: synthetic telemetry so the UI is honest with no hardware ──
  useEffect(() => {
    if (controlUrl) return;
    let t = 0;
    const timer = setInterval(() => {
      t += 0.12;
      const jointsRad = [0, 1, 2, 3, 4, 5].map(
        (i) => Math.sin(t + i * 0.9) * (0.5 + i * 0.1),
      );
      setTelemetry((prev) => ({
        ...prev,
        connected: true,
        enabled: false,
        jointsRad,
        jointsDeg: jointsRad.map((r) => (r * 180) / Math.PI),
        pose: {
          x: 220 + Math.sin(t) * 40,
          y: Math.cos(t) * 40,
          z: 180 + Math.sin(t * 0.7) * 20,
          rx: 180,
          ry: 0,
          rz: Math.sin(t * 0.5) * 15,
        },
      }));
    }, 100);
    return () => clearInterval(timer);
  }, [controlUrl]);

  const call = useCallback(
    async (service: string, payload?: unknown): Promise<boolean> => {
      const socket = socketRef.current;
      const serviceId = servicesRef.current.get(service);
      if (!socket || socket.readyState !== WebSocket.OPEN || serviceId == null) {
        setLastDenial("sin conexión con el hardware");
        return false;
      }
      const callId = callIdRef.current++;
      socket.send(encodeServiceCall(serviceId, callId, payload));

      return new Promise<boolean>((resolve) => {
        pendingRef.current.set(callId, resolve);
        // A service that never answers must not leave a button spinning
        // forever; the telemetry stream is the real source of truth anyway.
        setTimeout(() => {
          if (pendingRef.current.delete(callId)) resolve(false);
        }, 5000);
      });
    },
    [],
  );

  const clearDenial = useCallback(() => setLastDenial(null), []);

  return useMemo(
    () => ({
      link,
      telemetry,
      activity,
      viewers,
      role,
      lastDenial,
      authorizedToDrive,
      call,
      clearDenial,
    }),
    [
      link,
      telemetry,
      activity,
      viewers,
      role,
      lastDenial,
      authorizedToDrive,
      call,
      clearDenial,
    ],
  );
}

export { SERVICES };
