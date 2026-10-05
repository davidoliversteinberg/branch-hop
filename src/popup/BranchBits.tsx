import { Badge, Box, Button, Group, Text } from "@optiaxiom/react";
import { IconChevronLeft } from "@optiaxiom/icons";
import type { ReactNode } from "react";
import { branchColor } from "../shared/palette";
import type { BranchStatus } from "../shared/status.ts";

export function BranchDot({ branchKey }: { branchKey: string | null }) {
  return (
    <Box aria-hidden="true" display="flex" alignItems="center" justifyContent="center" flex="none" style={{ width: 20, height: 20 }}>
      <Box rounded="full" style={{ width: 8, height: 8, background: branchKey ? branchColor(branchKey) : "transparent" }} />
    </Box>
  );
}

/** Merged reads as done, not as an error, so it's black rather than red. */
export function StatusBadge({ status }: { status?: BranchStatus }) {
  if (status?.state === "merged") {
    return (
      <Badge intent="neutral" variant="strong">
        Merged
      </Badge>
    );
  }
  if (status?.state === "deleted") {
    return (
      <Badge intent="neutral" variant="subtle">
        Deleted
      </Badge>
    );
  }
  return null;
}

export function statusText(status?: BranchStatus): string | undefined {
  if (status?.state === "merged") return status.pr ? `Merged in #${status.pr.number}, no changes since. Safe to remove.` : "Merged, no changes since. Safe to remove.";
  if (status?.state === "deleted") return "This branch is gone from GitHub. Safe to remove.";
  return undefined;
}

/** The top of a sub-view (Settings, Share, Comments): a back button and a title. */
export function ViewHeader({ title, onBack, end }: { title: string; onBack: () => void; end?: ReactNode }) {
  return (
    <Group px="8" py="8" gap="4" alignItems="center" borderB="1" borderColor="border.secondary">
      <Button appearance="subtle" size="sm" icon={<IconChevronLeft />} aria-label="Back" onClick={onBack} />
      <Text fontWeight="500" truncate title={title} style={{ flex: 1, minWidth: 0 }}>
        {title}
      </Text>
      {end}
    </Group>
  );
}
