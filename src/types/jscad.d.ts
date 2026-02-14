declare module "@jscad/stl-serializer" {
  import { Geometry } from "@jscad/modeling";

  interface StlSerializerOptions {
    binary?: boolean;
  }

  interface StlSerializerResult {
    data: Uint8Array;
  }

  export function serialize(
    options: StlSerializerOptions,
    ...geometries: Geometry[]
  ): StlSerializerResult;
}

declare module "@jscad/regl-renderer" {
  import { Geometry } from "@jscad/modeling";

  interface Camera {
    position: number[];
    target: number[];
    up: number[];
    projection: string;
    near: number;
    far: number;
    fov: number;
  }

  interface RenderOptions {
    camera: Camera;
    drawCommands: {
      drawGrid: unknown;
      drawAxis: unknown;
      drawMesh: unknown;
    };
    entities: unknown[];
  }

  export const cameras: {
    camera: {
      create: () => Camera;
      setProjection: (camera: Camera, viewport: number[]) => Camera;
    };
  };

  export const controls: {
    orbit: {
      defaults: {
        position: number[];
      };
    };
  };

  export const drawCommands: {
    drawGrid: unknown;
    drawAxis: unknown;
    drawMesh: unknown;
  };

  export const entitiesFromSolids: (
    options: { color?: number[] },
    ...solids: Geometry[]
  ) => unknown[];

  export function prepareRender(options: {
    gl: WebGLRenderingContext;
  }): (options: RenderOptions) => void;
}