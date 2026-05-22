using System.Text.Json;
using System.Text.Json.Serialization;

namespace CafeJubilant_SOK.Converters
{
    public class FlexibleStringConverter : JsonConverter<string>
    {
        public override string? Read(
            ref Utf8JsonReader reader,
            Type typeToConvert,
            JsonSerializerOptions options)
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.String:
                    return reader.GetString();

                case JsonTokenType.Number:
                    if (reader.TryGetDecimal(out var decimalValue))
                    {
                        return decimalValue.ToString("F2");
                    }
                    if (reader.TryGetInt32(out var intValue))
                    {
                        return intValue.ToString();
                    }
                    return reader.GetDouble().ToString();

                case JsonTokenType.Null:
                    return "0.00";

                default:
                    return "0.00";
            }
        }

        public override void Write(
            Utf8JsonWriter writer,
            string value,
            JsonSerializerOptions options)
        {
            writer.WriteStringValue(value);
        }
    }
}