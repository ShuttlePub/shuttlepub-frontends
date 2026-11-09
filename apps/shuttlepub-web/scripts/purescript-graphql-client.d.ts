declare module "purescript-graphql-client" {
  export interface GeneratedFile {
    path: string;
    code: string;
  }

  export interface QualifiedTypeName {
    moduleName: string;
    typeName: string;
  }

  export interface GenerateSchemaOptions {
    url: string;
    dir?: string | null;
    modulePath?: string[] | null;
    useNewtypesForRecords?: boolean | null;
    gqlScalarsToPursTypes?: Record<string, string> | null;
    gqlToPursTypes?: Record<string, string | QualifiedTypeName> | null;
    enumImports?: string[] | null;
    customEnumCode?:
      | ((args: { name: string; values: Array<{ gql: string; transformed: string }> }) => string)
      | null;
    cache?: {
      get: (key: string) => Promise<unknown | null>;
      set: (entry: { key: string; val: unknown }) => Promise<void>;
    } | null;
    idImport?: QualifiedTypeName | null;
    fieldTypeOverrides?: Record<string, Record<string, QualifiedTypeName>> | null;
    enumValueNameTransform?: ((value: string) => string) | null;
  }

  export interface GenerateSchemaResult {
    schemas: GeneratedFile[];
    enums: GeneratedFile[];
    directives: GeneratedFile[];
    symbols: GeneratedFile;
  }

  export function generateSchema(opts: GenerateSchemaOptions): Promise<GenerateSchemaResult>;
}
