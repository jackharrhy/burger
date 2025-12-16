const itemIdToEid = new Map<string, number>();
const eidToItemId = new Map<number, string>();

const sessionIdToEid = new Map<string, number>();
const eidToSessionId = new Map<number, string>();

const sessionIdToNetworkId = new Map<string, string>();
const networkIdToSessionId = new Map<string, string>();

export const registerItemMapping = (itemId: string, eid: number): void => {
  itemIdToEid.set(itemId, eid);
  eidToItemId.set(eid, itemId);
};

export const registerPlayerMapping = (
  sessionId: string,
  eid: number,
  networkId: string
): void => {
  sessionIdToEid.set(sessionId, eid);
  eidToSessionId.set(eid, sessionId);
  sessionIdToNetworkId.set(sessionId, networkId);
  networkIdToSessionId.set(networkId, sessionId);
};

export const unregisterItemMapping = (itemId: string): void => {
  const eid = itemIdToEid.get(itemId);
  if (eid !== undefined) {
    itemIdToEid.delete(itemId);
    eidToItemId.delete(eid);
  }
};

export const unregisterPlayerMapping = (sessionId: string): void => {
  const eid = sessionIdToEid.get(sessionId);
  if (eid !== undefined) {
    sessionIdToEid.delete(sessionId);
    eidToSessionId.delete(eid);
  }
  const networkId = sessionIdToNetworkId.get(sessionId);
  if (networkId) {
    sessionIdToNetworkId.delete(sessionId);
    networkIdToSessionId.delete(networkId);
  }
};

export const getItemEid = (itemId: string): number | undefined => {
  return itemIdToEid.get(itemId);
};

export const getItemId = (eid: number): string | undefined => {
  return eidToItemId.get(eid);
};

export const getPlayerEid = (sessionId: string): number | undefined => {
  return sessionIdToEid.get(sessionId);
};

export const getSessionId = (eid: number): string | undefined => {
  return eidToSessionId.get(eid);
};

export const getNetworkId = (sessionId: string): string | undefined => {
  return sessionIdToNetworkId.get(sessionId);
};

export const getSessionIdFromNetworkId = (
  networkId: string
): string | undefined => {
  return networkIdToSessionId.get(networkId);
};
