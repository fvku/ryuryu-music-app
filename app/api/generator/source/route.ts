import { generatorHandler } from "@/lib/generator/http";
import { importDocument, importWeeklyDocument, parseImportPeriod, parseWeeklyImportPeriod, type MonthlyGeneratorSeries } from "@/lib/generator/source";
import { readGeneratorReleaseMaster } from "@/lib/generator/release-master";
import { GeneratorError } from "@/lib/generator/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return generatorHandler(request, async () => {
    const { searchParams } = new URL(request.url), series = searchParams.get("series");
    let period: string;
    if (series === "weekly") {
      period = searchParams.get("week") || "";
      if (searchParams.size !== 2) throw new GeneratorError("INVALID_INPUT", 400, "企画と対象週を確認してください。");
      parseWeeklyImportPeriod(period);
    } else if (series === "monthly" || series === "japan") {
      period = searchParams.get("month") || "";
      if (searchParams.size !== 2) throw new GeneratorError("INVALID_INPUT", 400, "企画と対象月を確認してください。");
      parseImportPeriod(period);
    } else {
      throw new GeneratorError("INVALID_INPUT", 400, "企画と対象期間を確認してください。");
    }
    const albums = await readGeneratorReleaseMaster();
    return series === "weekly" ? importWeeklyDocument(albums, period) : importDocument(albums, series as MonthlyGeneratorSeries, period);
  });
}
