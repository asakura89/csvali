enum TokenType {
    NotSet = 0,
    Text = 1,
    LineSeparator = 2,
    Delimiter = 3,
    Quote = 4,
    EndOfFile = 5
}

class Token {
    Type: TokenType;
    Value: string | null;

    constructor(type: TokenType, value: string | null) {
        this.Type = type;
        this.Value = value;
    }

    static get NotSet(): Token {
        return new Token(TokenType.NotSet, null);
    }

    toString(): string {
        if (this.Type === TokenType.Text)
            return `${TokenType[this.Type]}: '${this.Value}'`;

        return TokenType[this.Type];
    }
}

enum QuotingMode {
    Minimal = 0,
    QuoteAll = 1
}

class ParseSettings {
    FieldDelimiter: string;
    RowDelimiter: string;
    QuotingCharacter: string;
    QuotingMode: QuotingMode;

    constructor() {
        this.FieldDelimiter = ',';
        this.QuotingCharacter = '"';
        this.RowDelimiter = '\r\n';
        this.QuotingMode = QuotingMode.Minimal;
    }
}

class TextReader {
    private content: string;
    private position: number;

    constructor(content: string) {
        this.content = content;
        this.position = 0;
    }

    read(): number {
        if (this.position >= this.content.length)
            return -1;

        const code = this.content.charCodeAt(this.position);
        this.position++;
        return code;
    }

    peek(): number {
        if (this.position >= this.content.length)
            return -1;

        return this.content.charCodeAt(this.position);
    }
}

class Lexer {
    private Settings: ParseSettings;
    private FieldDelimiter: Token;
    private LineSeparator: Token;
    private Quote: Token;

    constructor(settings: ParseSettings) {
        if (!settings)
            throw new Error('settings');

        this.Settings = settings;
        this.FieldDelimiter = new Token(TokenType.Delimiter, settings.FieldDelimiter);
        this.LineSeparator = new Token(TokenType.LineSeparator, settings.RowDelimiter);
        this.Quote = new Token(TokenType.Quote, settings.QuotingCharacter);
    }

    private validateSettings() {
        if (!this.Settings.RowDelimiter)
            throw new Error('Csv row delimiter cannot be null.');

        if (this.Settings.RowDelimiter.length > 2)
            throw new Error('Csv row delimiter too long, maximum length: 2.');
    }

    *scan(input: string): Generator<Token> {
        const reader = new TextReader(input);
        yield* this.scanReader(reader);
    }

    *scanReader(reader: TextReader): Generator<Token> {
        this.validateSettings();
        const first = this.Settings.RowDelimiter[0];
        const second = this.Settings.RowDelimiter.length > 1 ? this.Settings.RowDelimiter[1] : null;
        let current: number;
        let buffer = "";
        while ((current = reader.read()) !== -1) {
            let special = new Token(TokenType.NotSet, null);
            if (String.fromCharCode(current) === this.Settings.FieldDelimiter) {
                special = this.FieldDelimiter;
            }
            else if (String.fromCharCode(current) === this.Settings.QuotingCharacter) {
                special = this.Quote;
            }
            else if (String.fromCharCode(current) === first) {
                if (!second) {
                    special = this.LineSeparator;
                }
                else if (reader.peek() === second.charCodeAt(0)) {
                    reader.read();
                    special = this.LineSeparator;
                }
            }

            if (special.Type !== TokenType.NotSet) {
                if (buffer.length > 0) {
                    yield new Token(TokenType.Text, buffer);
                    buffer = "";
                }
                yield special;
            }
            else {
                buffer += String.fromCharCode(current);
            }
        }
        if (buffer.length > 0)
            yield new Token(TokenType.Text, buffer)

        yield new Token(TokenType.EndOfFile, null)
    }
}

export class Parser {
    private OwnedReader: TextReader | null = null
    private tokens: Iterator<Token> | undefined
    private current: Token | undefined

    constructor(csv: string, settings?: ParseSettings)
    constructor(reader: TextReader, settings?: ParseSettings)
    constructor(csvOrReader: string | TextReader, settings?: ParseSettings) {
        if (typeof csvOrReader === 'string') {
            if (csvOrReader == null)
                throw new Error('csv');

            if (!settings)
                settings = new ParseSettings();

            const reader = new TextReader(csvOrReader);
            this.OwnedReader = reader;
            this.initialize(reader, settings);
        }
        else {
            const reader = csvOrReader;
            if (reader == null)
                throw new Error('reader');

            if (!settings)
                settings = new ParseSettings();

            this.initialize(reader, settings)
        }
    }

    private initialize(reader: TextReader, settings: ParseSettings) {
        const lexer = new Lexer(settings);
        this.tokens = lexer.scanReader(reader);
        /** this.moveNext() */
    }

    private get CurrentToken(): Token {
        if (!this.current)
            return Token.NotSet;

        return this.current;
    }

    private get CurrentTokenType(): TokenType {
        if (!this.current)
            return TokenType.NotSet;

        return this.current.Type;
    }

    public get HasMoreRows(): boolean {
        return this.CurrentTokenType !== TokenType.EndOfFile;
    }

    public ReadToEnd(): string[][] {
        const rows: string[][] = [];
        while (this.HasMoreRows) {
            const nextRowValues = this.ReadNextRow();
            if (this.HasMoreRows || nextRowValues !== null)
                rows.push(nextRowValues as string[]);
        }

        return rows;
    }

    public ReadNextRow(): string[] | null {
        if (!this.HasMoreRows)
            return null;

        const rowValues = [...this.ReadNextCsvValues()] as string[];
        if (!this.HasMoreRows && rowValues.length === 1 && rowValues[0] == null)
            return null;

        return rowValues;
    }

    private *ReadNextCsvValues(): Generator<string | null> {
        do {
            const nextValue = this.ReadNextCsvValue();
            yield nextValue;
        }
        while (this.CurrentTokenType === TokenType.Delimiter)
    }

    private ReadNextCsvValue(): string | null {
        const nextValue: string[] = [];
        if (this.CurrentTokenType === TokenType.EndOfFile)
            return null;

        let isQuoted = false;
        let isQuoteModeOn = false;
        while (true) {
            if (!this.moveNext())
                throw new Error('Unexpected end of lexer output, expected EndOfFile token.');

            if (isQuoteModeOn) {
                if (this.CurrentToken.Type === TokenType.Quote) {
                    isQuoteModeOn = false;
                }
                else {
                    nextValue.push(this.CurrentToken.Value || "");
                }
                continue;
            }

            /**
                NOTE:
                - https://github.com/microsoft/TypeScript/issues/52407
                - https://stackoverflow.com/questions/55018730/error-ts2678-type-string-is-not-comparable-to-type-in-angular-5
            */
            switch (this.CurrentTokenType as TokenType) {
                case TokenType.Delimiter:
                case TokenType.LineSeparator:
                case TokenType.EndOfFile:
                    if (nextValue.length === 0)
                        return null;

                    return nextValue.join("");
                case TokenType.Quote:
                    if (isQuoted) {
                        nextValue.push(this.CurrentToken.Value || "");
                    }
                    else {
                        isQuoted = true;
                    }
                    isQuoteModeOn = true;
                    continue;
                case TokenType.Text:
                    nextValue.push(this.CurrentToken.Value || "");
                    continue;
                default:
                    throw new Error(this.CurrentTokenType.toString());
            }
        }
    }

    private moveNext(): boolean {
        if (!this.tokens || this.tokens === null)
            return false;

        const result = this.tokens.next()
        if (result.done) {
            this.current = new Token(TokenType.EndOfFile, null);
            return false;
        }
        else {
            this.current = result.value;
            return true;
        }
    }

    public Dispose(): void {
        this.tokens = (function* () {})();
        if (this.OwnedReader)
            this.OwnedReader = null;
    }

    public static ParseSingleRow(singleRow: string, settings?: ParseSettings): (string | null)[] {
        if (singleRow == null)
            throw new Error('singleRow');

        if (!settings)
            settings = new ParseSettings();

        const parser = new Parser(singleRow, settings);
        const firstRow = parser.ReadNextRow() || [];
        parser.Dispose();

        return firstRow;
    }

    public static Parse(csv: string, settings?: ParseSettings): (string | null)[][] {
        if (csv == null)
            throw new Error('csv');

        if (!settings)
            settings = new ParseSettings();

        const parser = new Parser(csv, settings);
        const result = parser.ReadToEnd();
        parser.Dispose();

        return result;
    }
}

export interface IFormattable {
    toString(format?: string, culture?: CultureInfo): string
}

export class CultureInfo {
    name: string;
    constructor(name: string) {
        this.name = name;
    }
}

class TextWriter {
    write(line: string) {
        //throw new Error("Method not implemented.");
    }
}

export class Writer {
    private Settings: ParseSettings;
    private Writer: TextWriter;
    private LineAlreadyStarted: boolean;
    public FormattingCulture: CultureInfo;

    constructor(writer: TextWriter, settings?: ParseSettings) {
        this.Writer = writer;
        this.Settings = settings || new ParseSettings();
        this.LineAlreadyStarted = false;
        this.FormattingCulture = new CultureInfo('en-US');
    }

    WriteRawLine(line: string) {
        if (line == null)
            throw new Error('line');

        this.Writer.write(line);
        this.Writer.write(this.Settings.RowDelimiter);
        this.LineAlreadyStarted = false;
    }

    WriteLine(...values: string[]) {
        if (values == null)
            throw new Error('values');

        for (const value of values)
            this.Write(value);

        this.WriteRawLine("");
    }

    WriteLineFormattable(...values: IFormattable[]) {
        if (values == null)
            throw new Error('values');

        for (const value of values)
            this.WriteFormattable(value, null);

        this.WriteRawLine("");
    }

    private WriteRawValue(value: string | null) {
        if (this.LineAlreadyStarted)
            this.Writer.write(this.Settings.FieldDelimiter);

        this.Writer.write(value ?? "");
        this.LineAlreadyStarted = true;
    }

    Write(value: string | null) {
        this.WriteRawValue(Writer.WrapValueForCsv(value, this.Settings));
    }

    WriteFormattable(formattable: IFormattable | null, format?: string | null) {
        if (!formattable) {
            this.WriteRawValue(null);
            return;
        }

        if (format == null)
            format = this.GetDefaultFormatFor(formattable) as string;

        const formatted = formattable.toString(format, this.FormattingCulture);
        this.Write(formatted)
    }

    protected GetDefaultFormatFor(formattable: IFormattable): string | null {
        const asDate = formattable as unknown as Date;
        if (asDate instanceof Date && !isNaN(asDate.getTime()))
            return 's';

        return null;
    }

    static WrapValueForCsv(value: string | null, settings: ParseSettings): string | null {
        switch (settings.QuotingMode) {
            case QuotingMode.Minimal:
                return Writer.WrapValueForCsvUsingMinimalMode(value, settings);
            case QuotingMode.QuoteAll:
                return Writer.WrapValueForCsvUsingQuoteAllMode(value, settings);
            default:
                throw new Error(`Quoting mode ${settings.QuotingMode} is not yet implemented.`);
        }
    }

    private static WrapValueForCsvUsingMinimalMode(value: string | null, settings: ParseSettings): string | null {
        if (value == null)
            return null;

        if (value.length === 0)
            return value;

        const containsQuote = value.includes(settings.QuotingCharacter);
        if (
            containsQuote ||
            value.includes(settings.FieldDelimiter) ||
            value.includes(settings.RowDelimiter)
        ) {
            return (
                settings.QuotingCharacter +
                (containsQuote
                    ? value.replace(
                        new RegExp(settings.QuotingCharacter, 'g'),
                        settings.QuotingCharacter + settings.QuotingCharacter
                    )
                    : value) +
                settings.QuotingCharacter
            );
        }

        return value;
    }

    private static WrapValueForCsvUsingQuoteAllMode(value: string | null, settings: ParseSettings): string {
        const replaced = value ?
            value.replace(
                new RegExp(settings.QuotingCharacter, 'g'),
                settings.QuotingCharacter + settings.QuotingCharacter
            ) :
            "";

        return settings.QuotingCharacter + replaced + settings.QuotingCharacter;
    }
}

export async function readCsvAndParse(filePath: string): Promise<(string | null)[][]> {
    const content = await Deno.readTextFile(filePath);
    return new Parser(content).ReadToEnd();
}

/**
if (import.meta.main) {
    const filePath = Deno.args[0]
    const parsed = await readCsvAndParse(filePath)
    console.log(parsed)
}
*/

/**
console.table(
    new Parser(",,").ReadToEnd()
);
*/

const filePath: string = "C:/Users/ASMNetworkLabUsr/Downloads/Original_Sample.csv";
readCsvAndParse(filePath)
    .then(console.table);

const filePath2: string = "C:/Users/ASMNetworkLabUsr/Downloads/Mixed_Sample.csv";
readCsvAndParse(filePath2)
    .then(console.table);

