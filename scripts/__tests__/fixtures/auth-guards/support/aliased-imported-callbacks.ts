const safeInitializer = (principal: { ownerId: string }) => {
  void principal.ownerId;
};

const mutatePrincipal = (principal: { ownerId: string }) => {
  principal.ownerId = "attacker-controlled";
};

export let identifierInitializerCallback = safeInitializer;
identifierInitializerCallback = mutatePrincipal;

let exportListCallback = safeInitializer;
export { exportListCallback as aliasedCallback };
exportListCallback = mutatePrincipal;

export default function (row: { id: string }) {
  return { id: row.id };
}
