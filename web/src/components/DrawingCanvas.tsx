"use client";

import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Button } from "@/components/ui/button";
import { Stage, Layer, Line, Image as KonvaImage, Transformer } from "react-konva";
import { MousePointer2, Pencil, Eraser, Trash2, Save, Loader2 } from "lucide-react";
import type Konva from "konva";
import { API_URL, storageImageUrl } from "@/lib/api";

export interface DrawingCanvasProps {
  tramLineId: string;
  aspectRatio?: string | null;
  initialData?: {
    images?: Array<{ id: string; src: string; x: number; y: number; width: number; height: number }>;
    lines?: Array<{ points: number[]; color: string; width: number; tool: string }>;
    dimensions?: { width: number; height: number };
  };
  onSave?: (blob: Blob, composition: Record<string, unknown>) => Promise<void>;
}

export interface DrawingCanvasRef {
  addImage: (url: string, fill?: boolean) => void;
  getCanvasDataURL: () => Promise<string>;
}

interface CanvasImage {
  id: string;
  src: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image: HTMLImageElement;
}

interface CanvasLine {
  points: number[];
  color: string;
  width: number;
  tool: "pen" | "eraser";
}

function resolveCanvasImageSrc(src: string): string {
  const value = (src || "").trim();
  if (!value) return value;
  if (value.startsWith("data:")) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return storageImageUrl(value) ?? value;
}

function normalizeStoredImageSrc(src: string): string {
  const value = (src || "").trim();
  if (!value) return value;
  if (value.startsWith("data:")) return value;
  const marker = "/api/storage/";
  const idx = value.indexOf(marker);
  if (idx >= 0) {
    return value.slice(idx + marker.length).split("?")[0];
  }
  const apiStoragePrefix = `${API_URL}/api/storage/`;
  if (value.startsWith(apiStoragePrefix)) {
    return value.slice(apiStoragePrefix.length).split("?")[0];
  }
  return value;
}

function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function dataUrlToValidatedPngBlob(dataURL: string): Blob {
  const value = (dataURL || "").trim();
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) {
    throw new Error("Canvas export failed: expected PNG data URL");
  }
  const b64 = value.slice(prefix.length);
  if (!b64) {
    throw new Error("Canvas export failed: empty PNG payload");
  }
  let raw = "";
  try {
    raw = atob(b64);
  } catch {
    throw new Error("Canvas export failed: invalid base64 data");
  }
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  if (!isPngSignature(bytes)) {
    throw new Error("Canvas export failed: invalid PNG signature");
  }
  return new Blob([bytes], { type: "image/png" });
}

export const DrawingCanvas = forwardRef<DrawingCanvasRef, DrawingCanvasProps>(
  function DrawingCanvas({ tramLineId, initialData, onSave, aspectRatio }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<Konva.Stage>(null);
    const transformerRef = useRef<Konva.Transformer>(null);

    const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
    const [images, setImages] = useState<CanvasImage[]>([]);
    const [lines, setLines] = useState<CanvasLine[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tool, setTool] = useState<"select" | "pen" | "eraser">("pen");
    const [brushColor, setBrushColor] = useState("#000000");
    const [brushSize, setBrushSize] = useState(3);
    const [isDrawing, setIsDrawing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const createCanvasImage = (
      url: string,
      onLoad: (img: HTMLImageElement) => void,
      onError?: () => void
    ) => {
      const img = new Image();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        // Required for Konva export when images come from api domain with session auth.
        img.crossOrigin = "use-credentials";
      }
      img.onload = () => onLoad(img);
      img.onerror = () => {
        console.error("Failed to load image for canvas:", url);
        onError?.();
      };
      // Do not force crossOrigin here; some storage URLs do not send CORS headers.
      img.src = url;
    };

    useImperativeHandle(ref, () => ({
      addImage(url: string, fill = false) {
        createCanvasImage(url, (img) => {
          let x = 100;
          let y = 100;
          let width = 200;
          let height = 200;
          if (fill) {
            // Cover canvas while preserving source image aspect ratio.
            const canvasW = dimensions.width;
            const canvasH = dimensions.height;
            const imageAspect = img.width / Math.max(1, img.height);
            const canvasAspect = canvasW / Math.max(1, canvasH);
            if (imageAspect > canvasAspect) {
              height = canvasH;
              width = height * imageAspect;
              x = (canvasW - width) / 2;
              y = 0;
            } else {
              width = canvasW;
              height = width / Math.max(0.0001, imageAspect);
              x = 0;
              y = (canvasH - height) / 2;
            }
          } else {
            const maxSize = 200;
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            width = img.width * scale;
            height = img.height * scale;
            x = (dimensions.width - width) / 2;
            y = (dimensions.height - height) / 2;
          }
          const newImage: CanvasImage = {
            id: `img-${Date.now()}`,
            src: url,
            x,
            y,
            width,
            height,
            image: img,
            name: "Imported Image",
          };
          setImages((prev) => [...prev, newImage]);
          setTool("select");
          setSelectedId(newImage.id);
        });
      },
      async getCanvasDataURL() {
        const prev = selectedId;
        setSelectedId(null);
        await new Promise((r) => setTimeout(r, 0));
        let dataURL = "";
        if (stageRef.current) {
          dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
        }
        if (prev) setSelectedId(prev);
        return dataURL;
      },
    }));

    useEffect(() => {
      setSelectedId(null);
      if (initialData) {
        setLines(Array.isArray(initialData.lines) ? (initialData.lines as CanvasLine[]) : []);
        const loaded: CanvasImage[] = [];
        const incomingImages = Array.isArray(initialData.images) ? initialData.images : [];
        const pending = { count: incomingImages.length };
        const finalizeIfDone = () => {
          pending.count -= 1;
          if (pending.count <= 0) setImages(loaded);
        };
        incomingImages.forEach((imgData) => {
          const originalSrc = (imgData.src || "").trim();
          const resolvedSrc = resolveCanvasImageSrc(originalSrc);
          if (!resolvedSrc) {
            finalizeIfDone();
            return;
          }
          createCanvasImage(resolvedSrc, (img) => {
            loaded.push({ ...imgData, src: originalSrc || imgData.src, image: img } as CanvasImage);
            finalizeIfDone();
          }, finalizeIfDone);
        });
        if (incomingImages.length === 0) setImages([]);
      } else {
        setImages([]);
        setLines([]);
      }
    }, [tramLineId, initialData]);

    const handleSave = async () => {
      if (!stageRef.current || !onSave) return;
      try {
        setIsSaving(true);
        const prev = selectedId;
        setSelectedId(null);
        await new Promise((r) => setTimeout(r, 0));
        stageRef.current.batchDraw();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
        const blob = dataUrlToValidatedPngBlob(dataURL);
        if (blob.type !== "image/png" || blob.size <= 0) {
          throw new Error("Canvas export failed: invalid PNG blob");
        }
        const serializableImages = images.map(({ image, ...rest }) => ({
          ...rest,
          src: normalizeStoredImageSrc(rest.src),
        }));
        await onSave(blob, {
          images: serializableImages,
          lines,
          dimensions,
        });
        if (prev) setSelectedId(prev);
      } catch (e) {
        console.error("Failed to save canvas:", e);
      } finally {
        setIsSaving(false);
      }
    };

    useEffect(() => {
      const updateSize = () => {
        if (containerRef.current) {
          const width = containerRef.current.offsetWidth;
          let height = 500;
          if (aspectRatio) {
            const parts = aspectRatio.split(":").map(Number);
            if (parts[0] && parts[1]) height = width / (parts[0] / parts[1]);
            else height = width / (16 / 9);
          } else {
            height = width / (16 / 9);
          }
          setDimensions({ width, height });
        }
      };
      updateSize();
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }, [aspectRatio]);

    useEffect(() => {
      if (selectedId && transformerRef.current && stageRef.current) {
        const node = stageRef.current.findOne("#" + selectedId);
        if (node) {
          transformerRef.current.nodes([node]);
          transformerRef.current.getLayer()?.batchDraw();
        }
      } else if (transformerRef.current) {
        transformerRef.current.nodes([]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    }, [selectedId, images]);

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      if (!stageRef.current) return;
      const stage = stageRef.current;
      stage.setPointersPositions(e);
      const pos = stage.getPointerPosition();
      const x = pos?.x ?? 100;
      const y = pos?.y ?? 100;
      let dragData: { name?: string; src?: string; type?: string } = {};
      try {
        const j = e.dataTransfer.getData("application/json");
        if (j) dragData = JSON.parse(j);
      } catch {}
      const imageUrl =
        dragData.src ||
        e.dataTransfer.getData("text/plain") ||
        e.dataTransfer.getData("text/uri-list");
      const name = dragData.name || "Unknown";
      if (dragData.type === "placeholder" || !imageUrl) {
        const canvas = document.createElement("canvas");
        const size = 120;
        const tagHeight = 24;
        canvas.width = size;
        canvas.height = size + tagHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#6366f1";
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#4f46e5";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(size / 2, size / 2 - 10, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2 + 38, 30, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, size, size, tagHeight);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(name.length > 12 ? name.slice(0, 11) + "…" : name, size / 2, size + tagHeight / 2);
        const dataUrl = canvas.toDataURL("image/png");
        const img = new Image();
        img.onload = () => {
          setImages((prev) => [
            ...prev,
            {
              id: `img-${Date.now()}`,
              src: dataUrl,
              name,
              x: x - size / 2,
              y: y - (size + tagHeight) / 2,
              width: size,
              height: size + tagHeight,
              image: img,
            },
          ]);
          setTool("select");
        };
        img.src = dataUrl;
      } else {
        createCanvasImage(imageUrl, (img) => {
          const maxSize = 200;
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const w = img.width * scale;
          const h = img.height * scale;
          setImages((prev) => [
            ...prev,
            {
              id: `img-${Date.now()}`,
              src: imageUrl,
              name,
              x: x - w / 2,
              y: y - h / 2,
              width: w,
              height: h,
              image: img,
            },
          ]);
          setTool("select");
        });
      }
    };

    const handleMouseDown = (e: { target: { getStage: () => Konva.Stage | null } }) => {
      const stage = e.target.getStage();
      if (stage && e.target === stage) setSelectedId(null);
      if (tool === "select") return;
      const pos = stage?.getPointerPosition();
      if (!pos) return;
      setIsDrawing(true);
      setLines((prev) => [
        ...prev,
        { points: [pos.x, pos.y], color: brushColor, width: brushSize, tool },
      ]);
    };

    const handleMouseMove = (e: { target: { getStage: () => Konva.Stage | null } }) => {
      if (!isDrawing || tool === "select") return;
      const stage = e.target.getStage();
      const point = stage?.getPointerPosition();
      if (!point) return;
      setLines((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) last.points = last.points.concat([point.x, point.y]);
        return next;
      });
    };

    const handleMouseUp = () => setIsDrawing(false);

    const handleDragEnd = (id: string, e: { target: Konva.Node }) => {
      const node = e.target;
      setImages((prev) =>
        prev.map((img) =>
          img.id === id ? { ...img, x: node.x(), y: node.y() } : img
        )
      );
    };

    const handleTransformEnd = (id: string, e: { target: Konva.Node }) => {
      const node = e.target;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                x: node.x(),
                y: node.y(),
                width: Math.max(5, node.width() * scaleX),
                height: Math.max(5, node.height() * scaleY),
              }
            : img
        )
      );
    };

    const colors = [
      { name: "Black", value: "#000000" },
      { name: "Red", value: "#ef4444" },
      { name: "Blue", value: "#3b82f6" },
      { name: "Green", value: "#10b981" },
      { name: "Yellow", value: "#eab308" },
      { name: "Purple", value: "#a855f7" },
    ];

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap bg-secondary/20 p-2 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-background rounded-md border border-border p-1">
              <Button
                type="button"
                variant={tool === "select" ? "default" : "ghost"}
                size="sm"
                onClick={() => setTool("select")}
                className="h-8 w-8 p-0"
                title="Select"
              >
                <MousePointer2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={tool === "pen" ? "default" : "ghost"}
                size="sm"
                onClick={() => setTool("pen")}
                className="h-8 w-8 p-0"
                title="Pen"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={tool === "eraser" ? "default" : "ghost"}
                size="sm"
                onClick={() => setTool("eraser")}
                className="h-8 w-8 p-0"
                title="Eraser"
              >
                <Eraser className="h-4 w-4" />
              </Button>
            </div>
            {tool !== "select" && (
              <>
                <div className="w-px h-6 bg-border mx-1" />
                <div className="flex items-center gap-1">
                  {colors.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setBrushColor(c.value)}
                      className={`w-6 h-6 rounded-full border transition-transform ${
                        brushColor === c.value ? "scale-110 ring-2 ring-ring" : "border-border"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    />
                  ))}
                </div>
                <div className="w-px h-6 bg-border mx-1" />
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                  className="w-20"
                  title="Brush size"
                />
              </>
            )}
          </div>
        </div>
        <div
          ref={containerRef}
          className="border-2 border-border rounded-lg overflow-hidden bg-white shadow-inner relative"
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          style={{ height: dimensions.height }}
        >
          <Stage
            ref={stageRef}
            width={dimensions.width}
            height={dimensions.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
          >
            <Layer>
              {images.map((img) => (
                <KonvaImage
                  key={img.id}
                  id={img.id}
                  image={img.image}
                  x={img.x}
                  y={img.y}
                  width={img.width}
                  height={img.height}
                  draggable={tool === "select"}
                  onClick={() => tool === "select" && setSelectedId(img.id)}
                  onTap={() => tool === "select" && setSelectedId(img.id)}
                  onDragEnd={(e) => handleDragEnd(img.id, e)}
                  onTransformEnd={(e) => handleTransformEnd(img.id, e)}
                />
              ))}
              {lines.map((line, i) => (
                <Line
                  key={i}
                  points={line.points}
                  stroke={line.color}
                  strokeWidth={line.width}
                  tension={0.5}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={
                    line.tool === "eraser" ? "destination-out" : "source-over"
                  }
                />
              ))}
              <Transformer ref={transformerRef} />
            </Layer>
          </Stage>
          {images.length === 0 && lines.length === 0 && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-muted-foreground/30 text-sm">
              Drag images here or start drawing...
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 p-2 bg-secondary/10 rounded-lg">
          {selectedId && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setImages((prev) => prev.filter((i) => i.id !== selectedId));
                setSelectedId(null);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete Selected
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setImages([]);
              setLines([]);
              setSelectedId(null);
            }}
            disabled={!tramLineId}
          >
            <Trash2 className="h-4 w-4 mr-2" /> Clear
          </Button>
          {onSave && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !tramLineId}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Composition
            </Button>
          )}
        </div>
      </div>
    );
  }
);
