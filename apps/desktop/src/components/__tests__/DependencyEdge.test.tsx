import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Position } from '@xyflow/react';

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

import { DependencyEdge, type DependencyFlowEdge } from '../DependencyEdge.tsx';
import type { EdgeProps } from '@xyflow/react';

describe('DependencyEdge inline label editing', () => {
  it('opens inline editor when clicking the edge label and saves relationType and label', () => {
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    const props: EdgeProps<DependencyFlowEdge> = {
      id: 'edge-1',
      source: 'c1',
      target: 'c2',
      sourceX: 0,
      sourceY: 0,
      targetX: 200,
      targetY: 0,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        relationType: 'blocks',
        onUpdate,
        onDelete,
      },
    };

    render(
      <div>
        <DependencyEdge {...props} />
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit edge blocks' }));

    fireEvent.change(screen.getByLabelText('Edge relation type'), {
      target: { value: 'causes' },
    });
    fireEvent.change(screen.getByLabelText('Edge label'), {
      target: { value: 'triggers event' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save edge changes' }));

    expect(onUpdate).toHaveBeenCalledWith('edge-1', {
      relationType: 'causes',
      styleVariant: 'solid',
      label: 'triggers event',
    });
  });
});
