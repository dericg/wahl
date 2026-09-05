const presentations = {
  queued: {
    label: "Sent to Codex",
    description: "Your request is queued. Wahl will update this card as work begins.",
  },
  working: {
    label: "Codex is working",
    description: "Codex is preparing a proposed change. Wahl will update this card when the run finishes.",
  },
  pr_ready: {
    label: "Pull request ready",
    description: "The proposed change is ready for review. Publishing remains a separate step.",
  },
  no_change: {
    label: "No change proposed",
    description: "Codex completed its review but did not find a safe code change to propose.",
  },
  failed: {
    label: "Needs attention",
    description: "The request could not be completed. Review the workflow before retrying.",
  },
  closed: {
    label: "Pull request closed",
    description: "The pull request was closed. This does not confirm that the change was published.",
  },
};

export function fixPresentation(status) {
  return presentations[status] || {
    label: "Site improvement",
    description: "Progress is not available yet.",
  };
}

export function hasActiveFix(fixes) {
  return Object.values(fixes).some((fix) => fix.status === "queued" || fix.status === "working");
}
