function extractHostname(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return '';

  // IPv6 in brackets: [::1]:3000
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 0) return trimmed.slice(1, end);
  }

  // IPv4/hostname with optional port
  const parts = trimmed.split(':');
  return parts[0] || trimmed;
}

function isValidIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function isIpv6(hostname: string): boolean {
  return hostname.includes(':');
}

export function isIpAddress(hostname: string): boolean {
  return isValidIpv4(hostname) || isIpv6(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isValidIpv4(hostname)) return false;
  const [a, b] = hostname.split('.').map((n) => Number(n));
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

export function isLocalHostname(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true;
  // Internal Docker/K8s service names are typically single-label and not valid cookie domains.
  if (!hostname.includes('.')) return true;
  if (isPrivateIpv4(hostname)) return true;
  return false;
}

export function getCookieDomain(hostHeader: string): string | undefined {
  const hostname = extractHostname(hostHeader);
  if (!hostname) return undefined;
  if (isIpAddress(hostname)) return undefined;
  if (isLocalHostname(hostname)) return undefined;
  return `.${hostname}`;
}
