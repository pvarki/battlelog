import L from "leaflet";

// leaflet.markercluster is UMD and patches the global `L`; import this before it.
(window as unknown as { L: typeof L }).L = L;

export default L;
