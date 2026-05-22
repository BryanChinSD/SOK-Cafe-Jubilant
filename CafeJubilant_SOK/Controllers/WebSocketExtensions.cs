using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Builder;

namespace CafeJubilant_SOK.Controllers
{
    public static class WebSocketExtensions
    {
        public static IApplicationBuilder UseWebSocketHandler(
            this IApplicationBuilder app,
            string path,
            SokQueueWebSocketHandler handler)
        {
            return app.Map(path, builder =>
            {
                builder.Use(async (HttpContext context, RequestDelegate next) =>
                {
                    await handler.HandleAsync(context);
                });
            });
        }
    }
}
