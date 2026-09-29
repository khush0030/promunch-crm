// Turn a raw User-Agent into "Chrome on macOS" for the admin security view.
// Deliberately small: browser + OS families only, no version numbers.
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /node|undici|curl|python|Go-http|axios/i.test(ua) ? "Script / API client"
    : "Browser";
  const os =
    /iPhone|iPod/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}
