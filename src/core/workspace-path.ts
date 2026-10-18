/**
 * Strict workspace-relative path contract for native read-only tool intents.
 *
 * Paths come from untrusted web/model output. This module canonicalizes benign
 * forms to posix style and rejects every known Windows/posix escape or aliasing
 * primitive: absolute/UNC/drive forms, traversal and dot-only segments,
 * alternate data streams, trailing dot/space aliasing, reserved device names,
 * control characters and oversized inputs. Fail closed: anything not proven
 * safe returns null.
 *
 * Limitation (documented, not solved at this layer): string-level validation
 * cannot prove that no symlink or reparse point redirects the final resolution;
 * the native authority must re-check the opened handle.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_TOTAL_LENGTH = 4096;
const MAX_SEGMENT_LENGTH = 255;
const MAX_SEGMENTS = 64;

/** Returns the canonical posix relative path, or null when unsafe/ambiguous. */
export function normalizeWorkspacePath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_TOTAL_LENGTH) return null;
  // Control characters are never legitimate in a workspace path.
  if (/[\u0000-\u001F\u007F]/.test(path)) return null;
  // Absolute forms: root-relative ('/x', '\x'), UNC ('\\x', '//x') and any
  // drive form, including drive-relative ('C:foo') without a separator.
  if (/^[\\/]/.test(path)) return null;
  if (/^[A-Za-z]:/.test(path)) return null;

  const segments = path.split(/[\\/]+/);
  if (segments.length > MAX_SEGMENTS) return null;
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) return null;          // trailing/absent segment
    if (/^\.+$/.test(segment)) return null;         // '.', '..', '...' — dot-only
    if (segment.includes(':')) return null;         // alternate data stream / drive
    if (/[ .]$/.test(segment)) return null;         // Windows strips trailing dot/space
    if (WINDOWS_RESERVED.test(segment)) return null; // device names
    if (segment.length > MAX_SEGMENT_LENGTH) return null;
    out.push(segment);
  }
  const normalized = out.join('/');
  return normalized.length > MAX_TOTAL_LENGTH ? null : normalized;
}
