/**
 * Realtime: a change made before the channel is listening is not lost. CI run 44044915859: the partner joined
 * while the first phone's channel was still starting, and the first phone kept showing "Waiting for your
 * partner" because only a second subscription refetched.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Api, ChannelStatus } from './api';
import { keys } from './keys';
import { createRealtime } from './realtime';

function fakeApi() {
  let status: ((s: ChannelStatus) => void) | null = null;
  const api = {
    watchHousehold: (_hid: string, _onChange: unknown, onStatus: (s: ChannelStatus) => void) => {
      status = onStatus;
      return () => { status = null; };
    },
  } as unknown as Api;
  return { api, report: (s: ChannelStatus) => { status?.(s); } };
}

describe('realtime', () => {
  it('refetches everything when the channel first starts listening, and again after a drop', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    const { api, report } = fakeApi();
    const rt = createRealtime({ api, client, userId: () => 'u1' });
    rt.follow('h1');
    expect(spy).not.toHaveBeenCalled();

    report('subscribed');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith({ queryKey: keys.all('u1'), refetchType: 'all' });

    report('error');
    expect(spy).toHaveBeenCalledTimes(1);
    report('subscribed');
    expect(spy).toHaveBeenCalledTimes(2);
    rt.stop();
  });
});
