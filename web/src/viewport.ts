import { useMediaQuery } from "@mantine/hooks";

/**
 * One definition of "mobile" for the whole app: desktop layouts (the grid,
 * the management landing page, the results table) need ~1024px to work, so
 * everything under that gets the mobile treatment — phones and portrait
 * tablets alike. The height clause catches landscape phones. `screen` keeps a
 * printout (an A4 page is ~800px wide) on the desktop layout. Mirrored in
 * global.css (CSS can't import this).
 */
export const MOBILE_QUERY = "screen and (max-width: 1023px), screen and (max-height: 479px)";

export const useIsMobile = () =>
  useMediaQuery(MOBILE_QUERY, false, { getInitialValueInEffect: false });
