"use client";

import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Exports the transactions matching the current filters (all pages). */
export function ExportMenu() {
  const searchParams = useSearchParams();
  const href = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("format", format);
    return `/api/export/transactions?${params.toString()}`;
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Export">
          <DownloadIcon />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Export matching transactions</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={href("csv")} download>
            <FileTextIcon />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href("xlsx")} download>
            <FileSpreadsheetIcon />
            Excel (.xlsx)
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
