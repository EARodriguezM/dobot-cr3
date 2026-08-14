import { CdrWriter, emptyRequest } from "./cdr-writer";

// The CR3 command surface, as the edge gatekeeper exposes it.
//
// These names must match `edge/gateway/primbio_gateway/policy.py` exactly:
// the gatekeeper allowlists by service name, and anything not named there is
// refused. The raw driver services (/dobot_cr3_bringup/srv/*) are deliberately
// not reachable from a browser — the weblab node wraps them behind this small,
// vetted surface.

export const SERVICES = {
  enable: "/weblab/enable",
  disable: "/weblab/disable",
  estop: "/weblab/estop",
  clearError: "/weblab/clear_error",
  setSpeed: "/weblab/set_speed",
  jog: "/weblab/jog",
  jogStop: "/weblab/jog_stop",
  jointMove: "/weblab/joint_move",
  cartMove: "/weblab/cart_move",
  home: "/weblab/home",
  gripper: "/weblab/gripper",
  programRun: "/weblab/program_run",
  programStop: "/weblab/program_stop",
} as const;

/** Services that stop motion: allowed without the control lease, by design. */
export const STOP_SERVICES: ReadonlySet<string> = new Set([
  SERVICES.estop,
  SERVICES.disable,
  SERVICES.jogStop,
  SERVICES.programStop,
]);

// foxglove_bridge advertises `cdr` as the request encoding for every ROS 2
// service, so each request is serialized by hand. Field order must match the
// .srv files in edge/ros2/dobot_cr3_weblab_msgs/srv exactly — CDR is
// positional, so a reordered field is not an error, it is a wrong number sent
// to a robot.
export function encodeRequest(service: string, payload?: unknown): ArrayBuffer {
  const data = (payload ?? {}) as Record<string, unknown>;

  switch (service) {
    case SERVICES.jog:
      // Jog.srv: string axis_id
      return new CdrWriter().string(String(data.axis_id ?? "")).finish();

    case SERVICES.setSpeed:
      // SetSpeed.srv: int32 ratio
      return new CdrWriter().int32(Number(data.ratio ?? 50)).finish();

    case SERVICES.jointMove: {
      // JointMove.srv: float64[] joints_deg
      const joints = Array.isArray(data.joints_deg)
        ? (data.joints_deg as number[]).map(Number)
        : [];
      return new CdrWriter().float64Sequence(joints).finish();
    }

    case SERVICES.cartMove: {
      // CartMove.srv: float64 x y z rx ry rz
      const writer = new CdrWriter();
      for (const axis of ["x", "y", "z", "rx", "ry", "rz"] as const) {
        writer.float64(Number(data[axis] ?? 0));
      }
      return writer.finish();
    }

    case SERVICES.gripper:
      // Gripper.srv: float64 position, float64 max_effort
      return new CdrWriter()
        .float64(Number(data.position ?? 0))
        .float64(Number(data.max_effort ?? 50))
        .finish();

    case SERVICES.programRun:
      // RunProgram.srv: string name, string steps_json
      return new CdrWriter()
        .string(String(data.name ?? ""))
        .string(JSON.stringify(data.steps ?? []))
        .finish();

    default:
      // Everything else is std_srvs/srv/Trigger.
      return emptyRequest();
  }
}

export const JOINT_LABELS = ["J1", "J2", "J3", "J4", "J5", "J6"] as const;

export const POSE_AXES = [
  { label: "X", key: "x" },
  { label: "Y", key: "y" },
  { label: "Z", key: "z" },
  { label: "Rx", key: "rx" },
  { label: "Ry", key: "ry" },
  { label: "Rz", key: "rz" },
] as const;

export const JOG_JOINT_AXES = JOINT_LABELS.map((label, i) => ({
  label,
  id: `J${i + 1}`,
}));

export const JOG_CARTESIAN_AXES = POSE_AXES.map(({ label }) => ({
  label,
  id: label,
}));

// Spanish labels for the activity feed. The edge emits machine-readable
// service names so that localisation stays here, in the UI, where the rest of
// the Spanish copy lives.
const ACTION_LABELS: Record<string, string> = {
  [SERVICES.enable]: "habilitó el robot",
  [SERVICES.disable]: "deshabilitó el robot",
  [SERVICES.estop]: "activó el PARO DE EMERGENCIA",
  [SERVICES.clearError]: "limpió los errores",
  [SERVICES.setSpeed]: "cambió la velocidad",
  [SERVICES.jog]: "movió un eje",
  [SERVICES.jogStop]: "detuvo el movimiento",
  [SERVICES.jointMove]: "movió a una posición articular",
  [SERVICES.cartMove]: "movió a una posición cartesiana",
  [SERVICES.home]: "envió el robot a inicio",
  [SERVICES.gripper]: "accionó la pinza",
  [SERVICES.programRun]: "ejecutó un programa",
  [SERVICES.programStop]: "detuvo el programa",
  setParameters: "cambió la configuración",
};

/** Human-readable Spanish description of an activity event. */
export function describeAction(action: string, detail: unknown): string {
  const base = ACTION_LABELS[action] ?? `ejecutó ${action}`;
  const extra = describeDetail(action, detail);
  return extra ? `${base} · ${extra}` : base;
}

function describeDetail(action: string, detail: unknown): string {
  if (detail == null || typeof detail !== "object") return "";
  const data = detail as Record<string, unknown>;

  if (action === SERVICES.jog && typeof data.axis_id === "string") {
    return data.axis_id;
  }
  if (action === SERVICES.setSpeed && typeof data.ratio === "number") {
    return `${data.ratio}%`;
  }
  if (action === SERVICES.gripper && typeof data.position === "number") {
    return data.position > 0.005 ? "cerrar" : "abrir";
  }
  if (action === SERVICES.jointMove && Array.isArray(data.joints_deg)) {
    return (data.joints_deg as number[])
      .map((v) => (typeof v === "number" ? v.toFixed(0) : "?"))
      .join(", ");
  }
  if (action === SERVICES.programRun && typeof data.name === "string") {
    return data.name;
  }
  return "";
}

export interface JointState {
  jointsDeg: number[];
  jointsRad: number[];
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export interface RobotState {
  connected: boolean;
  enabled: boolean | null;
  speed: number;
  error: string;
}

export interface ProgramStatus {
  running: boolean;
  stepIndex: number;
  stepCount: number;
  programName: string;
  operatorName: string;
}

export const EMPTY_POSE: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
