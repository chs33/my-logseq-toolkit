export interface GraphDisplaySettings {
  arrows: boolean;
  nodeSize: number;
  linkThickness: number;
  textFadeThreshold: number;
}

export interface GraphForceSettings {
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
}

export const DEFAULT_DISPLAY_SETTINGS: GraphDisplaySettings = {
  arrows: true,
  nodeSize: 4,
  linkThickness: 1,
  textFadeThreshold: 0.55
};

export const DEFAULT_FORCE_SETTINGS: GraphForceSettings = {
  centerForce: 0.55,
  repelForce: 0.8,
  linkForce: 0.65,
  linkDistance: 95
};
