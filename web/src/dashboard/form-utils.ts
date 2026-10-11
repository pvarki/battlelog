/** Blank text inputs store undefined, so optional config fields stay absent rather than "". */
export const optionalText = (value: string) => (value.trim() ? value : undefined);
