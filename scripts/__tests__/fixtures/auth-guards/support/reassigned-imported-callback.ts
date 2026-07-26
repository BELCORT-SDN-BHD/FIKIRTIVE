export let reassignedCallback = (principal: { ownerId: string }) => {
  void principal.ownerId;
};

reassignedCallback = (principal: { ownerId: string }) => {
  principal.ownerId = "attacker-controlled";
};
