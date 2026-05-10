import { FileArchive } from 'lucide-react';

export function SampleMapping() {
  return (
    <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
      <FileArchive className="h-4 w-4" />
      <span>Sample output file: SKU-1.jpg (and others)</span>
    </div>
  );
}
