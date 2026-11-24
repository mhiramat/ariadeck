import type { BoardConversionAnalysis } from './types/models.js';

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
 * Thrown when adding a directed temporal edge would introduce a cycle in a flow board DAG.
 */
export class CyclicDependencyError extends AriadeckError {
  public readonly sourceCardId: string;
  public readonly targetCardId: string;

  constructor(
    sourceCardId: string,
    targetCardId: string,
    message?: string,
    code = 'CYCLIC_DEPENDENCY'
  ) {
    const defaultMessage =
      sourceCardId === targetCardId
        ? `Cannot connect card "${sourceCardId}" to itself: self-loops are not allowed.`
        : `Cannot connect card "${sourceCardId}" to "${targetCardId}": creating this dependency would introduce a cycle in the board DAG.`;
    super(code, message ?? defaultMessage);
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
 * Thrown when input arguments violate domain invariants (e.g., fewer than 2 cards for split/merge,
 * invalid edge type/direction for board type, or unsupported operation on flat boards).
 */
export class ValidationError extends AriadeckError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(code, message);
  }
}

/**
 * Thrown when converting a flat board to a flow board fails under strategy='abort'
 * because incompatible edges or temporal cycles exist.
 */
export class BoardConversionError extends AriadeckError {
  public readonly analysis: BoardConversionAnalysis;

  constructor(analysis: BoardConversionAnalysis, message?: string) {
    super(
      'ERR_BOARD_CONVERSION_REQUIRES_RESOLUTION',
      message ??
        `Board "${analysis.boardId}" cannot be converted cleanly from "${analysis.currentType}" to "${analysis.targetType}". Resolve incompatible edges or pass strategy="demote_incompatible".`
    );
    this.analysis = analysis;
  }
}
