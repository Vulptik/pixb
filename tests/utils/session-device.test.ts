import { describe, expect, it } from 'vitest';
import { sessionDevice } from '@/lib/utils/sessionDevice';

describe('sessionDevice', () => {
  it('recognizes Edge before its embedded Chrome and Safari tokens', () => {
    expect(
      sessionDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/156.0 Safari/537.36 Edg/156.0'),
    ).toEqual({ browser: 'Edge', system: 'Windows' });
  });
  it('recognizes mobile Safari and Chrome on iOS', () => {
    expect(
      sessionDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', system: 'iOS' });
    expect(
      sessionDevice('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/156.0 Safari/604.1'),
    ).toEqual({ browser: 'Chrome', system: 'iOS' });
  });
  it('leaves unknown clients available for a localized fallback', () => {
    expect(sessionDevice('External uploader')).toEqual({ browser: '', system: '' });
  });
});
