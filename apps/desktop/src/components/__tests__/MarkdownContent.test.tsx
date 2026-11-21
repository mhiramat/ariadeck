import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownContent } from '../MarkdownContent.tsx';

describe('MarkdownContent', () => {
  it('renders headings, bold, lists, task checkboxes, code, and links', () => {
    const markdown = [
      '## Scene Notes',
      '',
      'Includes **bold** text, `inline_code`, and a [reference](https://example.com).',
      '',
      '- [x] Completed step',
      '- [ ] Pending step',
    ].join('\n');

    render(<MarkdownContent content={markdown} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Scene Notes' })).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('inline_code').tagName).toBe('CODE');

    const link = screen.getByRole('link', { name: 'reference' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('escapes raw HTML tags safely without executing scripts', () => {
    render(<MarkdownContent content={'Hello <script>alert("xss")</script> **world**'} compact />);
    expect(screen.getByText('world').tagName).toBe('STRONG');
    expect(document.querySelector('script')).toBeNull();
  });
});
