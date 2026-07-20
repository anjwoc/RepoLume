import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Converts a heading string to a URL-safe anchor id.
// Keeps ASCII word chars, Hangul syllables (가-힣), and hyphens.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w가-힣-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}
