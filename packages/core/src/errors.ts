/**
 * Base class for all domain errors thrown by @ariadeck/core.
 */
export class AriadeckError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when adding a directed edge would introduce a cycle in the board DAG.
 */
export class CyclicDependencyError extends AriadeckError {
  public readonly sourceCardId: string;
  public readonly targetCardId: string;

  constructor(sourceCardId: string, targetCardId: string, message?: string) {
    const defaultMessage =
      sourceCardId === targetCardId
        ? `Cannot connect card "${sourceCardId}" to itself: self-loops are not allowed.`
        : `Cannot connect card "${sourceCardId}" to "${targetCardId}": creating this dependency would introduce a cycle in the board DAG.`;
    super('CYCLIC_DEPENDENCY', message ?? defaultMessage);
    this.sourceCardId = sourceCardId;
    this.targetCardId = targetCardId;
  }
}

/**
 * Thrown when a referenced board, card, edge, or attachment does not exist or is soft-deleted.
 */
export class NotFoundError extends AriadeckError {
  public readonly entityType: string;
  public readonly entityId: string;

  constructor(entityType: string, entityId: string) {
    super('NOT_FOUND', `${entityType} "${entityId}" was not found.`);
    this.entityType = entityType;
    this.entityId = entityId;
  }
}

/**
 * Thrown when input arguments violate domain invariants (e.g., fewer than 2 cards for split/merge).
 */
export class ValidationError extends AriadeckError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}
