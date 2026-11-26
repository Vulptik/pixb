import { ImageResponse } from 'next/og';
import { createTranslator } from 'next-intl';
import { getAppUrl } from '@/lib/server/appUrl';
import en from '../../../messages/en.json';
import fr from '../../../messages/fr.json';

export async function GET(request: Request, { params }: { params: Promise<{ image: string }> }) {
  const { image } = await params;
  if (image !== 'pixb-en.png' && image !== 'pixb-fr.png') {
    return new Response(null, { status: 404 });
  }

  const locale = image === 'pixb-fr.png' ? 'fr' : 'en';
  const messages = locale === 'fr' ? fr : en;
  const t = createTranslator({ locale, messages: { meta: messages.meta }, namespace: 'meta' });
  const url = await getAppUrl(request);
  const gold = '#825923';

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '80px 88px 56px',
        backgroundColor: '#f5f2eb',
        color: '#302b25',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 88, fontWeight: 700 }}
      >
        <svg width="96" height="96" viewBox="0 0 64 64">
          <g fill={gold} transform="rotate(-9 32 32)">
            <rect x="8" y="8" width="20" height="20" rx="5.7" />
            <rect x="36" y="8" width="20" height="20" rx="5.7" opacity=".72" />
            <rect x="8" y="36" width="20" height="20" rx="5.7" opacity=".45" />
            <rect x="36" y="36" width="20" height="20" rx="5.7" />
          </g>
        </svg>
        <div style={{ display: 'flex', letterSpacing: '-5px' }}>
          PixB<span style={{ color: gold }}>.</span>
        </div>
      </div>
      <div style={{ marginTop: 100, fontSize: 55, letterSpacing: '-1.5px' }}>
        {t('socialHeading')}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 'auto',
          borderTop: '1px solid #ded8cd',
          paddingTop: 23,
          color: gold,
          fontSize: 21,
        }}
      >
        <div style={{ maxWidth: '100%', textAlign: 'right', overflowWrap: 'break-word' }}>
          {url}
        </div>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { 'Cache-Control': 'no-store' } },
  );
}
