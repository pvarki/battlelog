import { Text } from "@mantine/core";
import type { ReactNode } from "react";

/** The app's one heading inside panels, drawers and settings forms: small caps over a group of fields or rows. */
export const SectionHeading = ({ children }: { children: ReactNode }) => (
  <Text component="h3" className="section-heading">
    {children}
  </Text>
);
