/**
 * Per-session Canvas UI state: shelf contributions and registered commands
 * for the active program. Cleared when the program stops.
 */
import type { ProgramCommand, ShelfContribution } from '@shared/types';

export class CanvasSessionState {
  private shelfByProgram = new Map<string, ShelfContribution[]>();
  private commandsByProgram = new Map<string, ProgramCommand[]>();

  constructor(private readonly onShelfChanged: (items: ShelfContribution[]) => void) {}

  setShelf(programId: string, items: ShelfContribution[]): void {
    this.shelfByProgram.set(programId, items);
    this.onShelfChanged(items);
  }

  clearShelf(programId: string): void {
    this.shelfByProgram.delete(programId);
    this.onShelfChanged([]);
  }

  shelfFor(programId: string | null): ShelfContribution[] {
    if (!programId) return [];
    return this.shelfByProgram.get(programId) ?? [];
  }

  setCommands(programId: string, commands: ProgramCommand[]): void {
    this.commandsByProgram.set(programId, commands);
  }

  commandsFor(programId: string): ProgramCommand[] {
    return this.commandsByProgram.get(programId) ?? [];
  }

  onProgramStopped(programId: string): void {
    this.clearShelf(programId);
    this.commandsByProgram.delete(programId);
  }
}
