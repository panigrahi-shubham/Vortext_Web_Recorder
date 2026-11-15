// Shared, serializable types. Everything here can travel between the page,
// the Node process and the side panel as plain JSON.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Information about the repeated row/card/list item that contains an element. */
export interface RepeatInfo {
  containerRole: string | null; // 'row' | 'listitem' | 'article' | ... or null
  containerTag: string;
  containerClasses: string[]; // only classes that look hand-written and stable
  containerTestId: string | null;
  siblings: number; // how many items share the container's signature
  anchorText: string | null; // short text that is unique among those items
  index: number; // 0-based index among the same-signature items
}

/** Serializable description of one element, built inside the page. */
export interface ElementDescriptor {
  tag: string;
  role: string | null;
  name: string; // accessible name estimated in the page (verified later by Playwright)
  text: string; // normalized visible text, max 120 chars
  testId: string | null;
  testIdAttr: string;
  id: string | null;
  label: string | null;
  placeholder: string | null;
  alt: string | null;
  title: string | null;
  inputType: string | null;
  nameAttr: string | null; // the HTML name="" attribute (used for field naming)
  classes: string[];
  rect: Rect;
  editable: boolean;
  checked: boolean | null;
  disabled: boolean;
  inShadow: boolean;
  headingLevel: number | null;
  repeat: RepeatInfo | null;
  /** Up to 3 ancestors, used when the element itself has no usable locator. */
  ancestors?: AncestorDescriptor[];
  /** In-page registry id so Node can get a handle to the element. */
  targetId?: number;
}

export interface AncestorDescriptor extends Omit<ElementDescriptor, 'ancestors'> {
  level: number;
}

export type TextMatch = string | { regex: string; flags?: string };

export type LocatorPart =
  | { kind: 'testId'; value: string }
  | { kind: 'role'; role: string; name?: TextMatch; exact?: boolean }
  | { kind: 'label' | 'placeholder' | 'altText' | 'title' | 'text'; value: TextMatch; exact?: boolean }
  | { kind: 'css'; selector: string }
  | { kind: 'filter'; hasText: TextMatch }
  | { kind: 'nth'; index: number };

/** A locator as data. `frames` are CSS selectors for nested iframes, outermost first. */
export interface LocatorChain {
  frames: string[];
  parts: LocatorPart[];
}

export type CandidateKind =
  | 'testId'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'altText'
  | 'title'
  | 'text'
  | 'css'
  | 'scoped'
  | 'nth'
  | 'coords';

export interface Candidate {
  kind: CandidateKind;
  chain: LocatorChain;
  base: number;
  dynamic: boolean;
  dynamicLevel?: 0 | 1 | 2;
  warnings: string[];
  fromAncestor?: number; // levels climbed (0 = element itself)
  anchor?: string | null; // anchor text of a scoped locator
}

export interface Verification {
  count: number;
  matchesTarget: boolean;
  error?: string;
}

export interface RankedCandidate extends Candidate {
  score: number;
  code: string; // rendered against `page`
  verification: Verification | null;
  usable: boolean; // unique and resolves to the target (or a coordinate fallback)
}

export interface LocatorChoice {
  best: RankedCandidate;
  alternatives: RankedCandidate[];
}

export type ClickStyle = 'locator' | 'fallback' | 'coords';

/** A resolved element reference stored on a step. */
export interface TargetRef {
  chain: LocatorChain;
  code: string;
  score: number;
  kind: CandidateKind;
  warnings: string[];
  role: string | null;
  name: string;
  tag: string;
  text: string;
  inputType: string | null;
  label: string | null;
  placeholder: string | null;
  testId: string | null;
  nameAttr: string | null;
  anchor: string | null;
  describe: string;
  rect?: Rect;
}

export type AssertType =
  | 'visible'
  | 'hidden'
  | 'enabled'
  | 'disabled'
  | 'editable'
  | 'checked'
  | 'unchecked'
  | 'focused'
  | 'textEquals'
  | 'textContains'
  | 'valueEquals'
  | 'attributeEquals'
  | 'countEquals'
  | 'urlMatches'
  | 'titleMatches'
  | 'screenshot'
  | 'a11y';

export interface Assertion {
  type: AssertType;
  target: TargetRef | null; // null for page-level checks (URL, title, a11y)
  expected?: string | number;
  regex?: boolean; // `expected` is a RegExp source
  attrName?: string;
}

export interface Suggestion {
  id: string;
  assertion: Assertion;
  label: string; // "heading 'Checkout' appeared"
  reason: 'appeared' | 'disappeared' | 'changed' | 'navigated';
  score: number;
  accepted: boolean;
  pageUrl: string; // the page the check runs on
  elementKey?: string;
}

export type ActionKind =
  | 'copyText'
  | 'pasteText'
  | 'goto'
  | 'click'
  | 'dblclick'
  | 'rightclick'
  | 'hover'
  | 'fill'
  | 'press'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'upload'
  | 'drag'
  | 'scrollIntoView'
  | 'assert'
  | 'waitVisible'
  | 'waitHidden';

export interface StepPage {
  url: string;
  title: string;
  heading: string | null;
  tab: number; // 0 = first tab, 1 = first popup, ...
}

export interface Step {
  inputMode?: 'fill' | 'type' | 'append';
  typingDelay?: number;
  id: string;
  kind: ActionKind;
  target: TargetRef | null;
  target2?: TargetRef | null; // drop target for drag
  alternatives?: RankedCandidate[];
  value?: string; // fill value, url, key
  values?: string[]; // select options
  files?: string[];
  assertion?: Assertion;
  page: StepPage;
  preAssert: boolean;
  clickStyle: ClickStyle;
  coords?: { x: number; y: number; vw: number; vh: number };
  suggestions: Suggestion[];
  settleMs?: number;
  settleTimedOut?: boolean;
  warnings: string[];
  secret?: boolean;
  fieldName?: string;
  popup?: { tab: number; url: string };
  dialog?: { type: string; message: string; action: 'accept' | 'dismiss' };
  download?: { suggestedFilename: string };
  comment?: string; // free note from the panel
  createdAt: number;
}

// ---------- snapshots ----------

export type VolatileKind = 'spinner' | 'modal' | 'overlay' | 'dialog' | 'alert' | 'status' | 'toast';

export interface SnapElement {
  key: string; // structural identity used to match the same element across snapshots
  d: ElementDescriptor;
  value: string | null;
  selected: boolean | null;
  expanded: boolean | null;
  pressed: boolean | null;
  volatile: VolatileKind | null;
  landmark: boolean;
  leaf?: boolean; // no element children: its text can be asserted exactly
  /** iframe selector chain when the element lives in a child frame. */
  frames?: string[];
  /** Filled by Node for some elements: a verified locator taken in this state. */
  locator?: TargetRef | null;
}

export interface RepeatGroup {
  key: string;
  count: number;
  role: string | null;
  tag: string;
  classes: string[];
  testId: string | null;
  locator?: TargetRef | null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: SnapElement[];
  groups: RepeatGroup[];
  focusedKey: string | null;
}

export interface GenerateOptions {
  testIdAttr?: string;
  flowName: string;
  viewport: { width: number; height: number };
  baseURL?: string;
  style: 'pom' | 'flat';
  keepSecrets: boolean;
  outDirFromCwd?: string; // used for upload placeholder paths, e.g. 'tests'
  coordsAsRatio?: boolean;
  stepGroupThreshold?: number; // default 8
  storageState?: string; // written as test.use({ storageState }) when recording started logged in
}

export interface GeneratedFile {
  path: string; // relative to --out, forward slashes
  content: string;
}
