using Microsoft.AspNetCore.Mvc;

namespace CafeJubilant_SOK.Controllers
{
    public class KIOSK : Controller
    {
        public IActionResult Home()
        {
            return View();
        }
        
        public IActionResult Websocket()
        {
            return View();
        }
        
        public IActionResult POSViewer()
        {
            return View();
        }
    }
}