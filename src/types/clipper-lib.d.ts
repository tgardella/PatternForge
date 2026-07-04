declare module "clipper-lib" {
  export interface IntPoint { X: number; Y: number }
  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    Execute(solution: IntPoint[][], delta: number): void;
  }
  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
  export const EndType: {
    etClosedPolygon: number;
    etClosedLine: number;
    etOpenButt: number;
    etOpenSquare: number;
    etOpenRound: number;
  };
  export class Paths extends Array<IntPoint[]> {}
  const ClipperLib: {
    ClipperOffset: typeof ClipperOffset;
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    Paths: typeof Paths;
  };
  export default ClipperLib;
}
