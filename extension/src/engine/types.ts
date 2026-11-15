/** How a piece of text is matched. Mirrors Playwright's string / exact / RegExp options. */
export type TextMatch =
  | { kind: 'string'; value: string; exact: boolean }
  | { kind: 'regex'; source: string; flags: string };

/** One locator step in framework-neutral form. Emitters turn this into Playwright or Selenium code. */
export type Step =
  | { kind: 'testid'; attr: string; value: string }
  | { kind: 'id'; id: string }
  | { kind: 'nameAttr'; tag: string; value: string }
  | { kind: 'role'; role: string; name?: TextMatch }
  | { kind: 'label' | 'placeholder' | 'alt' | 'title' | 'text'; text: TextMatch }
  | { kind: 'css'; selector: string }
  | { kind: 'xpath'; expr: string };

export type Stability = 'high' | 'medium' | 'low';

export interface Candidate {
  /** Which rule produced it: testid, role, label, text, css, xpath, anchored-role ... */
  strategy: string;
  score: number;
  stability: Stability;
  /** Playwright TypeScript expression, e.g. page.getByRole('button', { name: 'Save' }) */
  playwright: string;
  /** Selenium Java By expression, or null when this strategy has no Selenium form. */
  selenium: string | null;
  /** Rule trace: why this locator was built this way. */
  notes: string[];
  /** Present for locators anchored to a repeating container: same locator with the row text as a parameter. */
  param?: { playwright: string; selenium: string | null; sample: string; key: string };
}

export interface Rejection {
  locator: string;
  reason: string;
}

export interface FrameRef {
  selector: string;
  verified: boolean;
}

export interface ElementInfo {
  tag: string;
  role: string | null;
  name: string;
  text: string;
  suggestedName: string;
  inShadow: boolean;
  frames: FrameRef[];
  retargetedFrom?: string;
}

export interface PickResult {
  info: ElementInfo;
  candidates: Candidate[];
  rejected: Rejection[];
  ms: number;
  url: string;
  /** Title of the top-level page, used to name the Page Object class. */
  title?: string;
  /** Handle the content script uses to find the element again (highlighting). */
  refId?: number;
}

export interface EngineSettings {
  /** Attributes treated as test ids, in priority order. */
  testIdAttrs: string[];
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  testIdAttrs: ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy'],
};
