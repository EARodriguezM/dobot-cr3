// What a form action reports back to the component that submitted it.
//
// Actions used to answer by redirecting to `?m=<code>`, which meant every save
// was a navigation and every outcome lived in the URL. Returning the outcome
// instead lets the form render its own result in place — and, since these forms
// now open over a live teleoperation session, without unmounting it.
//
// The code is machine-readable and the Spanish wording belongs to the UI, for
// the same reason the activity feed translates service names rather than
// having the edge send prose.
export interface ActionResult {
  ok: boolean;
  code: string;
}

/** Nothing submitted yet. */
export const IDLE: ActionResult | null = null;
