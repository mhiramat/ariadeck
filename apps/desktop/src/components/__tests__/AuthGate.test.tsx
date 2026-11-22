import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useBoardStore } from '../../store/useBoardStore.ts';
import { AuthGate } from '../AuthGate.tsx';

describe('AuthGate', () => {
  beforeEach(() => {
    useBoardStore.setState({
      authRequired: true,
      authenticated: false,
      authError: null,
    });
  });

  it('submits the access token and renders authentication errors', async () => {
    const loginSpy = vi.fn().mockResolvedValue(true);
    useBoardStore.setState({ login: loginSpy });

    render(<AuthGate />);

    const input = screen.getByLabelText('Access Token');
    fireEvent.change(input, { target: { value: 'my-secret-token' } });
    fireEvent.click(screen.getByRole('button', { name: /Unlock Workspace/i }));

    await waitFor(() => {
      expect(loginSpy).toHaveBeenCalledWith('my-secret-token');
    });
  });

  it('displays authError alert when login fails', () => {
    useBoardStore.setState({ authError: 'Invalid access token.' });
    render(<AuthGate />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid access token.');
  });

  it('loads and submits an access token from a selected token file', async () => {
    const loginSpy = vi.fn().mockResolvedValue(true);
    useBoardStore.setState({ login: loginSpy });

    render(<AuthGate />);

    const fileInput = screen.getByLabelText('Load token from file') as HTMLInputElement;
    const tokenFile = new File(['file-based-secret-token\n'], 'auth-token', {
      type: 'text/plain',
    });
    Object.defineProperty(tokenFile, 'text', {
      value: vi.fn().mockResolvedValue('file-based-secret-token\n'),
    });

    fireEvent.change(fileInput, { target: { files: [tokenFile] } });

    await waitFor(() => {
      expect(loginSpy).toHaveBeenCalledWith('file-based-secret-token');
    });
  });
});
