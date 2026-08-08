// Shape of the camera-wall arrangement, shared by the server (which loads and
// saves it) and the client (which renders it).
//
// It lives in its own module rather than next to the component on purpose: a
// value exported from a "use client" module and imported by a Server Component
// arrives as a client reference, not as the data — so the default below would
// silently become an object with no `slots`, and the wall would crash on its
// first render.

export interface WallLayout {
  count: number;
  preset: string;
  slots: (string | null)[];
}

export const DEFAULT_LAYOUT: WallLayout = {
  count: 1,
  preset: "single",
  slots: [null, null, null, null],
};
