import { ApiError } from '@/lib/api/errors';
import { graphemeCount } from '@/lib/thought-contract';

// High-confidence rules only. Ordinary grief, trauma and non-instructional
// crisis discussion are allowed. No HTML/Markdown parsing occurs anywhere.
export function validateThoughtBody(input: string): string {
  const body = input.replace(/[\u200B\u2060\uFEFF]/gu, '').trim();
  if (
    !body ||
    !body.replace(/[\p{Default_Ignorable_Code_Point}\p{Mark}\s]/gu, '') ||
    graphemeCount(body) > 280 ||
    new TextEncoder().encode(body).length > 16384 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body)
  )
    throw new ApiError('INVALID_INPUT');
  const normalized = body.normalize('NFKC');
  if (
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|https?:\/\/|\b0?9\d{9}\b|\+63\s?9[\d\s-]{9,14}\b/iu.test(
      normalized,
    ) ||
    /\b(?:kill yourself|you should (?:kill yourself|commit suicide)|i (?:will|am going to) kill you)\b/iu.test(
      normalized,
    )
  )
    throw new ApiError('CONTENT_REJECTED');
  return body;
}
