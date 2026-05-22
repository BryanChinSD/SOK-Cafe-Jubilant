using CafeJubilant_SOK.Services;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using CafeJubilant_SOK.Controllers;
using CafeJubilant_SOK.Models;
using System.Threading.Channels;
using System.Text.Json;
using System.Text.Json.Serialization;
using RawPrint;
using System.Drawing.Printing;
using System.IO;
using System.Threading.Tasks;

namespace CafeJubilant_SOK
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // ✅ Load device ID from args OR environment variable OR default config
            var deviceId = args.FirstOrDefault(a => a.StartsWith("--device="))
                               ?.Replace("--device=", "")
                           ?? Environment.GetEnvironmentVariable("DEVICE_ID")
                           ?? "01"; // fallback

            // ✅ Load base config first, then overlay the device-specific config
            builder.Configuration
                .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
                .AddJsonFile($"appsettings_Device{deviceId}.json", optional: true, reloadOnChange: true);

 
            // =========================
            // Kestrel configuration
            // =========================
            builder.WebHost.ConfigureKestrel(options =>
            {
                options.Limits.MaxRequestHeadersTotalSize = 52428800; // 50 MB
                options.Limits.MaxRequestLineSize = 52428800;
                options.Limits.MaxRequestBufferSize = 52428800;
                options.Limits.MaxRequestBodySize = 52428800;
                options.Limits.KeepAliveTimeout = TimeSpan.FromHours(24);
                options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(10);

      
                if (builder.Environment.IsDevelopment())
                {
                    // Bind to port 5000 locally
                    options.ListenAnyIP(5000);
                }

            });

   
            builder.Services.Configure<IISServerOptions>(options =>
            {
                options.MaxRequestBodySize = 52428800;
                options.MaxRequestBodyBufferSize = 52428800;
            });

     
            builder.Services.AddHttpClient();
            builder.Services.AddSingleton<WebSocketConnectionManager>();
            builder.Services.AddSingleton<OrderStore>();

            builder.Services.AddControllersWithViews()
                .AddJsonOptions(options =>
                {
                    options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
                    options.JsonSerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;
                    options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
                    options.JsonSerializerOptions.WriteIndented = false;
                    options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
                    options.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
                });

            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", policy =>
                {
                    policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
                });
            });

            builder.Services.AddSession(options =>
            {
                options.IdleTimeout = TimeSpan.FromMinutes(30);
                options.Cookie.HttpOnly = true;
                options.Cookie.IsEssential = true;
            });

            builder.Services.Configure<EberSettings>(builder.Configuration.GetSection("Eber"));
            builder.Services.Configure<OutletSettings>(builder.Configuration.GetSection("Outlet"));
            builder.Services.AddScoped<IPrinterService, PrinterService>();
            // ✅ Required — lets scheduler resolve KIOSKController from DI
            builder.Services.AddScoped<KIOSKController>();

            // ✅ Scheduler
            builder.Services.AddHostedService<CashReconStatusScheduler>();
            var app = builder.Build();

            // =========================
            // Log WebSocket manager ready
            // =========================
            using (var scope = app.Services.CreateScope())
            {
                var wsManager = scope.ServiceProvider.GetRequiredService<WebSocketConnectionManager>();
                var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
                logger.LogInformation("🔄 Application started - WebSocket manager ready");
            }

            // =========================
            // Middleware
            // =========================
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Home/Error");
                app.UseHsts();
            }

            app.UseWhen(context => !context.WebSockets.IsWebSocketRequest,
                appBuilder => appBuilder.UseHttpsRedirection());

            app.UseStaticFiles();
            app.UseRouting();

            // Handle CORS preflight
            app.Use(async (context, next) =>
            {
                if (context.Request.Method == "OPTIONS")
                {
                    context.Response.StatusCode = 200;
                    context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
                    context.Response.Headers.Append("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                    context.Response.Headers.Append("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
                    await context.Response.CompleteAsync();
                    return;
                }
                await next();
            });

            app.UseCors("AllowAll");
            app.UseAuthentication();
            app.UseAuthorization();
            app.UseSession();

            // WebSocket middleware
            app.UseWebSockets(new WebSocketOptions
            {
                KeepAliveInterval = TimeSpan.FromSeconds(30),
                ReceiveBufferSize = 64 * 1024  // 64 KB
            });
            // Routing
            app.MapControllerRoute(
                name: "default",
                pattern: "{controller=KIOSK}/{action=Home}/{id?}"
            );

            app.Run();
        }
    }
}
