// Inspection is deliberately independent of graph navigation and camera state.
export function inspectRecord(state, id) {
  return { ...state, current: { ...state.current, selectedId: id } };
}

export function navigateGraph(state, next) {
  return { history: [...state.history, state.current], current: { ...state.current, camera: null, ...next } };
}

export function returnToGraph(state, index = state.history.length - 1) {
  if (index < 0 || index >= state.history.length) return state;
  return { history: state.history.slice(0, index), current: state.history[index] };
}
