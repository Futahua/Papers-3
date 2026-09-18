/** Durable identity for a native window member. Runtime HWNDs, helper tokens,
 * and binding ids are deliberately absent; resolution must issue fresh runtime
 * authority and fail closed on missing or ambiguous matches. */
export interface PersistedWindowMemberDescriptor {
  version: 1;
  windowInstanceId?: string;
  executableFingerprint?: string;
  title: string;
}
