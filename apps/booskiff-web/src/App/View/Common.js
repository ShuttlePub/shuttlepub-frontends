// Keep modifier-click and auxiliary-click browser behavior for genuine links.
export const shouldFollowInApp = (event) => event.button === 0 && !event.defaultPrevented
  && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
