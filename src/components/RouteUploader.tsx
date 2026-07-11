import { useCallback, useRef, useState } from "react";

interface RouteUploaderProps {
  onFileLoaded: (xmlText: string, fileName: string) => void;
  disabled?: boolean;
}

export function RouteUploader({ onFileLoaded, disabled }: RouteUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".gpx")) {
        alert("Ожидается файл .gpx");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        onFileLoaded(reader.result as string, file.name);
      };
      reader.readAsText(file);
    },
    [onFileLoaded],
  );

  return (
    <div
      className={`route-uploader${isDragging ? " route-uploader--dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFile(e.dataTransfer.files[0]);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".gpx"
        hidden
        disabled={disabled}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <p>Перетащите GPX-файл сюда или нажмите, чтобы выбрать</p>
    </div>
  );
}
