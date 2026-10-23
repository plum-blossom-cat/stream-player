/** Hand-off from other screens to the workspace form ("Edit stream", "Edit profile"). */
export const workspace = $state({
  /** @type {{ stream: StreamFormData, profileId?: string, profileName?: string } | null} */
  draft: null,
});
