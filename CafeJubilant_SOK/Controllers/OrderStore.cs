using CafeJubilant_SOK.Controllers;
using CafeJubilant_SOK.Models;
using System.Collections.Concurrent;
using static CafeJubilant_SOK.Models.KioskModel;

namespace CafeJubilant_SOK.Services
{
    public class OrderStore
    {
        private readonly ConcurrentDictionary<string, SOKOrder> _orders = new();

        public ConcurrentDictionary<string, SOKOrder> Orders => _orders;

        public List<SOKOrder> GetAllOrders() =>
            _orders.Values.OrderByDescending(o => o.CreatedAt).ToList();

        public void AddOrder(SOKOrder order) => _orders[order.OrderId] = order;
        public bool TryRemove(string orderId, out SOKOrder order) => _orders.TryRemove(orderId, out order);
        public bool TryGet(string orderId, out SOKOrder order) => _orders.TryGetValue(orderId, out order);
    }
}
