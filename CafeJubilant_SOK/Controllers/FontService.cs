//using Microsoft.Extensions.Logging;
//using SkiaSharp;
//using System;
//using System.Collections.Generic;
//using System.IO;

//namespace CafeJubilant_SOK.Services
//{
//    public interface IFontService
//    {
//        void EnsureFontsInstalled();
//    }

//    public class FontService : IFontService
//    {
//        private readonly ILogger<FontService> _logger;
//        private static bool _installed = false;
//        private static readonly object _lock = new();

//        // ── Font file names to look for ───────────────────────────────────────
//        private static readonly string[] FontFileNames = new[]
//        {
//            "NotoSansSC-Regular.ttf",
//            "NotoSansSC-Bold.ttf",
//            "NotoSansSC-Medium.ttf",
//            "NotoSansSC-Regular.otf",
//            "NotoSerifSC-Black.otf",
//        };

//        public FontService(ILogger<FontService> logger)
//        {
//            _logger = logger;
//        }

//        // ── Called once before any PDF rendering ──────────────────────────────
//        public void EnsureFontsInstalled()
//        {
//            if (_installed) return;

//            lock (_lock)
//            {
//                if (_installed) return;

//                // Search in multiple locations
//                var searchPaths = new[]
//                {
//                    Path.Combine(AppContext.BaseDirectory, "fonts"),
//                    Path.Combine(AppContext.BaseDirectory, "wwwroot", "fonts"),
//                    Path.Combine(Directory.GetCurrentDirectory(), "fonts"),
//                    Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "fonts"),

//                    // Windows system fonts fallback
//                    @"C:\Windows\Fonts",
//                    Path.Combine(
//                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
//                        "Microsoft", "Windows", "Fonts"
//                    ),
//                };

//                int registered = 0;

//                foreach (var dir in searchPaths)
//                {
//                    if (!Directory.Exists(dir)) continue;

//                    foreach (var fontName in FontFileNames)
//                    {
//                        var fullPath = Path.Combine(dir, fontName);
//                        if (!File.Exists(fullPath)) continue;

//                        try
//                        {
//                            // SkiaSharp loads fonts from file path at render time
//                            // We validate the file is a valid font here
//                            using var typeface = SKTypeface.FromFile(fullPath);
//                            if (typeface == null)
//                            {
//                                _logger.LogWarning(
//                                    "FontService — Invalid font file: {Path}", fullPath);
//                                continue;
//                            }

//                            _logger.LogInformation(
//                                "FontService — Found font: {FamilyName} | Style: {Style} | Path: {Path}",
//                                typeface.FamilyName, typeface.FontStyle, fullPath);

//                            registered++;
//                        }
//                        catch (Exception ex)
//                        {
//                            _logger.LogWarning(ex,
//                                "FontService — Failed to validate font: {Path}", fullPath);
//                        }
//                    }
//                }

//                if (registered == 0)
//                {
//                    _logger.LogWarning(
//                        "FontService — No CJK fonts found. " +
//                        "Chinese characters may not render correctly. " +
//                        "Place NotoSansSC-Regular.ttf in the 'fonts' folder next to the executable.");
//                }
//                else
//                {
//                    _logger.LogInformation(
//                        "FontService — {Count} CJK font(s) validated successfully", registered);
//                }

//                _installed = true;
//            }
//        }

//        // ── Helper: get full path of first found font file ────────────────────
//        public static string? FindFontPath(string fontFileName)
//        {
//            var searchPaths = new[]
//            {
//                Path.Combine(AppContext.BaseDirectory, "fonts"),
//                Path.Combine(AppContext.BaseDirectory, "wwwroot", "fonts"),
//                Path.Combine(Directory.GetCurrentDirectory(), "fonts"),
//                Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "fonts"),
//                @"C:\Windows\Fonts",
//            };

//            foreach (var dir in searchPaths)
//            {
//                var fullPath = Path.Combine(dir, fontFileName);
//                if (File.Exists(fullPath)) return fullPath;
//            }

//            return null;
//        }

//        // ── Build SKPaint with CJK typeface for a given font name ─────────────
//        public static SKTypeface? GetTypeface(string fontFileName)
//        {
//            var path = FindFontPath(fontFileName);
//            if (path == null) return null;

//            try
//            {
//                return SKTypeface.FromFile(path);
//            }
//            catch
//            {
//                return null;
//            }
//        }
//    }
//}