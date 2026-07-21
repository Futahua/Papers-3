/**
 * Shared contract types for Papers 3.
 *
 * These types cross the main <-> renderer boundary. Papers validates their
 * structure (see schemas.ts) but never interprets program-specific payloads
 * such as selection reference types.
 */

// ---------------------------------------------------------------------------
// Backpacks
// ---------------------------------------------------------------------------

/**
 * Backpacks are machine-wide working environments. `canvas` is retained only
 * so data created by the earlier integration prototype remains readable.
 */
export type BackpackType = 'environment' | 'canvas';

export interface BackpackSummary {
  id: string;
  name: string;
  type: BackpackType;
  createdAt: string;
  lastEnteredAt: string | null;
  archived: boolean;
  /** Optional folder passed to the existing Hermes Desktop product on launch. */
  workspacePath: string | null;
}

export interface BackpackRegistryState {
  schemaVersion: 1;
  backpacks: BackpackSummary[];
  lastActiveBackpackId: string | null;
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export interface ProgramManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  entry: string;
  stateSchemaVersion: number;
  capabilities: string[];
  /** Optional program accent color for the launcher tile. */
  accentColor?: string;
  description?: string;
}

export interface ProgramIdentity {
  backpackId: string;
  programId: string;
  programName: string;
  programVersion: string;
  apiVersion: 1;
}

export type ProgramRunState =
  | 'stopped'
  | 'loading'
  | 'running'
  | 'crashed'
  | 'quarantined';

export interface ProgramStatus {
  programId: string;
  state: ProgramRunState;
  crashCount: number;
  lastCrashAt: string | null;
  quarantineReason: string | null;
}

export interface ShelfContribution {
  id: string;
  label: string;
  /** Command id invoked in the program when the shelf item is clicked. */
  commandId: string;
  title?: string;
}

export interface ProgramCommand {
  id: string;
  label: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface CapabilityRequest {
  invocationId: string;
  backpackId: string;
  programId: string;
  capability: string;
  arguments: unknown;
  reason: string;
}

export type PermissionDecision = 'allow-once' | 'allow-program' | 'deny';

export interface PermissionGrant {
  backpackId: string;
  programId: string;
  capability: string;
  decision: 'allow-program';
  grantedAt: string;
}

export interface PermissionsState {
  schemaVersion: 1;
  grants: PermissionGrant[];
}

export interface PendingPermissionPrompt {
  promptId: string;
  request: CapabilityRequest;
  /** Human-readable summary of what will happen if allowed. */
  summary: string;
}

export interface CapabilityError {
  code:
    | 'denied'
    | 'not-declared'
    | 'invalid-arguments'
    | 'invalid-sender'
    | 'unavailable'
    | 'failed'
    | 'not-granted';
  message: string;
  capability?: string;
}

// ---------------------------------------------------------------------------
// Agent invocation (plan section 13)
// ---------------------------------------------------------------------------

export interface ProgramReference {
  /** Program-defined reference type, opaque to Papers. */
  type: string;
  /** Program-defined identifier, opaque to Papers. */
  id: string;
  /** Optional program-defined qualifier (e.g. line range), opaque to Papers. */
  detail?: unknown;
}

export interface SharedMaterialItem {
  reference: ProgramReference;
  title: string;
  mediaType: string;
  /** Short preview text always shown in the invocation preview. */
  preview: string;
  /** SHA-256 hex of the full content at capture time. */
  contentHash: string;
  /** Full content when included; omitted content must be disclosed. */
  content?: string;
  /** True when content was truncated before sharing. */
  truncated?: boolean;
  /** Bytes of the original content before truncation/omission. */
  originalByteLength?: number;
}

export interface AgentInvocation {
  version: 1;
  origin: {
    backpackId: string;
    programId: string;
    viewId?: string;
    commandId: string;
  };
  action: {
    id: string;
    label: string;
    creatorInstruction?: string;
  };
  selection: {
    type: string;
    references: ProgramReference[];
  };
  sharedMaterial: SharedMaterialItem[];
  destination: {
    programId: string;
    type: string;
    reference?: ProgramReference;
  };
  permissions: string[];
  execution?: {
    /** Granted git-worktree resource selected by program code. */
    resourceId?: string;
    /** Host-resolved path recorded after validation; never accepted from program code. */
    cwd?: string;
    hermesProjectId?: string;
    preferredWorker?: 'hermes' | 'codex' | 'opencode';
  };
}

// ---------------------------------------------------------------------------
// Agent runs (plan sections 14, 15)
// ---------------------------------------------------------------------------

export type AgentRunState =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'waiting-clarification'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentRunReference {
  runId: string;
  /** Authoritative Hermes session id once known. */
  sessionId: string | null;
}

/** A public Hermes event, projected without interpretation. */
export interface AgentRunEvent {
  runId: string;
  sequence: number;
  timestamp: string;
  kind: string;
  /** Short human-readable rendering of the event. */
  text: string;
}

export interface AgentPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AgentPendingInteraction {
  kind: 'approval' | 'clarification';
  requestId: string;
  title: string;
  detail: string;
  options: AgentPermissionOption[];
}

export interface AgentRunSnapshot {
  runId: string;
  backpackId: string;
  programId: string;
  actionLabel: string;
  state: AgentRunState;
  sessionId: string | null;
  createdAt: string;
  completedAt: string | null;
  events: AgentRunEvent[];
  pendingInteraction: AgentPendingInteraction | null;
  /** Failure classification when state is failed. */
  failure: RunFailure | null;
  invocation: AgentInvocation;
  result: AgentResultProposal | null;
}

export interface RunFailure {
  component: 'hermes' | 'papers' | 'worker' | 'invocation';
  code: string;
  message: string;
  retryUseful: boolean;
  detail?: string;
}

export interface ResultArtifact {
  id: string;
  title: string;
  mediaType: string;
  /** Absolute path registered by the host after validation. */
  path?: string;
  content?: string;
}

export interface ProgramOperation {
  /** Program-defined operation type, opaque to Papers. */
  type: string;
  /** Program-defined payload, opaque to Papers. */
  payload: unknown;
}

export interface AgentResultProposal {
  invocationId: string;
  sessionId: string;
  summary: string;
  structuredOutput?: unknown;
  artifacts?: ResultArtifact[];
  proposedOperations?: ProgramOperation[];
}

// ---------------------------------------------------------------------------
// Save status and recovery
// ---------------------------------------------------------------------------

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface HostErrorReport {
  component: string;
  what: string;
  known: string;
  intact: string;
  retryUseful: boolean;
  inspect: string;
  recover: string;
}

// ---------------------------------------------------------------------------
// Hermes health
// ---------------------------------------------------------------------------

export type HermesHealth =
  | { state: 'unavailable'; detail: string }
  | { state: 'starting' }
  | { state: 'connected'; protocolVersion: number; agentName: string }
  | { state: 'disconnected'; detail: string };
