/**
 * Snowflake Icon Mapping - COMPLETE COLLECTION
 * ALL 150+ useful icons for Snowflake architecture diagrams
 */

// Helper inline SVGs for account boundary containers (dashed boxes, brand colors)
const boundarySvg = (stroke: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg width="96" height="72" viewBox="0 0 96 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="84" height="60" rx="10" ry="10" stroke="${stroke}" stroke-width="4" stroke-dasharray="10 6" fill="none" />
    </svg>`
  )}`;

export const SNOWFLAKE_ICONS: Record<string, string> = {
  // ===== CORE SNOWFLAKE OBJECTS (RA - Resource Access) =====
  
  // Data Sources & Stages
  external_stage: '/icons/Snowflake_ICON_RA_Stage_External.svg',
  internal_stage: '/icons/Snowflake_ICON_RA_Stage.svg',
  
  // Warehouses (All Types)
  warehouse: '/icons/Snowflake_ICON_RA_Virtual_Warehouse.svg',
  warehouse_snowpark: '/icons/Snowflake_ICON_Warehouse_Snowpark.svg',
  warehouse_data: '/icons/Snowflake_ICON_Warehouse_Data.svg',
  warehouse_adaptive: '/icons/Snowflake_ICON_Warehouse_Adaptive.svg',
  warehouse_gen2: '/icons/Snowflake_ICON_Warehouse_Gen2.svg',
  
  // Compute
  task: '/icons/Snowflake_ICON_RA_Task.svg',
  
  // Functions (All Types)
  stored_proc: '/icons/Snowflake_ICON_RA_Function_Stored_Procedure.svg',
  function: '/icons/Snowflake_ICON_RA_Function.svg',
  udf: '/icons/Snowflake_ICON_RA_Function_User-Defined_SQL.svg',
  udf_java: '/icons/Snowflake_ICON_RA_Function_User-Defined_Java.svg',
  udf_javascript: '/icons/Snowflake_ICON_RA_Function_User-Defined_JavaScript.svg',
  udf_table: '/icons/Snowflake_ICON_RA_Function_User-Defined_Table.svg',
  external_function: '/icons/Snowflake_ICON_RA_Function_External.svg',
  aggregate_function: '/icons/Snowflake_ICON_RA_Function_Aggregate.svg',
  window_function: '/icons/Snowflake_ICON_RA_Function_Window.svg',
  table_function: '/icons/Snowflake_ICON_RA_Function_Table.svg',
  system_function: '/icons/Snowflake_ICON_RA_Function_System.svg',
  scalar_function: '/icons/Snowflake_ICON_RA_Function_Scalar.svg',
  
  // Tables (All Types)
  table: '/icons/Snowflake_ICON_RA_Table.svg',
  dynamic_table: '/icons/Snowflake_ICON_RA_Table_Dynamic.svg',
  iceberg_table: '/icons/Snowflake_ICON_RA_Table_Iceberg.svg',
  hybrid_table: '/icons/Snowflake_ICON_RA_Table_Hybrid.svg',
  external_table: '/icons/Snowflake_ICON_RA_Table_External.svg',
  directory_table: '/icons/Snowflake_ICON_RA_Table_Directory.svg',
  
  // Views
  view: '/icons/Snowflake_ICON_RA_View.svg',
  materialized_view: '/icons/Snowflake_ICON_RA_View_Materialized.svg',
  secure_view: '/icons/Snowflake_ICON_RA_View_Secure.svg',
  
  // Streams & Pipes
  stream: '/icons/Snowflake_ICON_RA_Stream.svg',
  snowpipe: '/icons/Snowflake_ICON_RA_Pipe.svg',
  
  // Databases & Schemas
  database: '/icons/Snowflake_ICON_RA_Snowflake_Database.svg',
  schema: '/icons/Snowflake_ICON_Database.svg',
  volume: '/icons/Snowflake_ICON_RA_Volume.svg',
  failover_group: '/icons/Snowflake_ICON_RA_Failover_Group.svg',
  failover_group_ds: '/icons/Snowflake_ICON_RA_Failover_Group_Data_Science.svg',
  failover_group_finance: '/icons/Snowflake_ICON_RA_Failover_Group_Finance.svg',
  failover_group_it: '/icons/Snowflake_ICON_RA_Failover_Group_IT.svg',
  failover_group_sales: '/icons/Snowflake_ICON_RA_Failover_Group_Sales.svg',
  
  // Security & Governance - Policies
  policy: '/icons/Snowflake_ICON_RA_Policy.svg',
  policy_masking: '/icons/Snowflake_ICON_RA_Policy_Masking.svg',
  policy_network: '/icons/Snowflake_ICON_RA_Policy_Network.svg',
  policy_row: '/icons/Snowflake_ICON_RA_Policy_Row.svg',
  policy_session: '/icons/Snowflake_ICON_RA_Policy_Session.svg',
  
  // Security & Governance - Roles
  role: '/icons/Snowflake_ICON_RA_Role.svg',
  role_accountadmin: '/icons/Snowflake_ICON_RA_Role_Account_Admin.svg',
  role_securityadmin: '/icons/Snowflake_ICON_RA_Role_Security_Admin.svg',
  role_sysadmin: '/icons/Snowflake_ICON_RA_Role_Sys_Admin.svg',
  role_useradmin: '/icons/Snowflake_ICON_RA_Role_User_Admin.svg',
  role_orgadmin: '/icons/Snowflake_ICON_RA_Role_Org_Admin.svg',
  role_public: '/icons/Snowflake_ICON_RA_Role_Public.svg',
  
  // Users & Tags
  user: '/icons/Snowflake_ICON_User_1.svg',
  user_2: '/icons/Snowflake_ICON_User_2.svg',
  users: '/icons/Snowflake_ICON_Users.svg',
  users_multiple: '/icons/Snowflake_ICON_Users_Multiple.svg',
  tag: '/icons/Snowflake_ICON_RA_Tag.svg',
  
  // Data
  data: '/icons/Snowflake_ICON_RA_Data.svg',
  structured_data: '/icons/Snowflake_ICON_Structured_Data.svg',
  semi_structured_data: '/icons/Snowflake_ICON_Semi_Structured_Data.svg',
  unstructured_data: '/icons/Snowflake_ICON_Unstructured_Data.svg',
  
  // File Formats (All Types)
  file: '/icons/Snowflake_ICON_RA_File.svg',
  file_csv: '/icons/Snowflake_ICON_RA_File_CSV.svg',
  file_json: '/icons/Snowflake_ICON_RA_File_JSON.svg',
  file_parquet: '/icons/Snowflake_ICON_RA_File_Parquet.svg',
  file_avro: '/icons/Snowflake_ICON_RA_File_AVRO.svg',
  file_xml: '/icons/Snowflake_ICON_RA_File_XML.svg',
  file_text: '/icons/Snowflake_ICON_RA_File_Text.svg',
  file_image: '/icons/Snowflake_ICON_RA_File_Image.svg',
  file_video: '/icons/Snowflake_ICON_RA_File_Video.svg',
  file_audio: '/icons/Snowflake_ICON_RA_File_Audio.svg',
  file_excel: '/icons/Snowflake_ICON_RA_File_XLW.svg',
  generic_file: '/icons/Snowflake_ICON_Generic_File.svg',
  
  // ===== ML & AI =====
  cortex: '/icons/Snowflake_ICON_Cortex.svg',
  cortex_search: '/icons/Snowflake_ICON_Universal_Search.svg',
  cortex_analyst: '/icons/Snowflake_ICON_Copilot.svg',
  ai_star: '/icons/Snowflake_ICON_AI_Star.svg',
  ml_model: '/icons/Snowflake_ICON_AI_Star_Triple.svg',
  notebook: '/icons/Snowflake_ICON_Snowpark.svg',
  snowpark: '/icons/Snowflake_ICON_Snowpark.svg',
  document_ai: '/icons/Snowflake_ICON_Document_AI.svg',
  snowconvert_ai: '/icons/Snowflake_ICON_SnowConvert_AI.svg',
  
  // ===== APPS & CONTAINERS =====
  snowpark_container: '/icons/Snowflake_ICON_Snowpark_Containers.svg',
  streamlit: '/icons/Snowflake_ICON_Streamlit_in_Snowflake.svg',
  native_app: '/icons/Snowflake_ICON_Native_App.svg',
  web_app: '/icons/Snowflake_ICON_Web_App.svg',
  application: '/icons/Snowflake_ICON_Application.svg',
  application_collab: '/icons/Snowflake_ICON_Application_Collaboration.svg',
  marketplace: '/icons/Snowflake_ICON_Marketplace.svg',
  
  // ===== INTEGRATIONS & DATA SOURCES =====
  s3: '/icons/Snowflake_ICON_Cloud.svg',
  kafka: '/icons/Snowflake_ICON_Kafka_Connectors.svg',
  api: '/icons/Snowflake_ICON_3rd_Party.svg',
  third_party_app: '/icons/Snowflake_ICON_3rd_Party_App_2.svg',
  hadoop: '/icons/Snowflake_ICON_Hadoop.svg',
  hadoop_replace: '/icons/Snowflake_ICON_Hadoop_Replace.svg',
  spark_connect: '/icons/Snowflake_ICON_Spark_Connect.svg',
  iot: '/icons/Snowflake_ICON_IoT.svg',
  
  // ===== DATA SHARING & COLLABORATION =====
  share: '/icons/Snowflake_ICON_Sharing_Collaboration.svg',
  private_exchange: '/icons/Snowflake_ICON_Private_Data_Exchange.svg',
  public_exchange: '/icons/Snowflake_ICON_Public_Data_Exchange.svg',
  notification: '/icons/Snowflake_ICON_Alert.svg',
  
  // ===== WORKLOADS =====
  workload_ai: '/icons/Snowflake_ICON_Workloads_AI.svg',
  workload_ai_highlight: '/icons/Snowflake_ICON_Workloads_AI_Highlight.svg',
  workload_collaboration: '/icons/Snowflake_ICON_Workloads_Collaboration.svg',
  workload_cybersecurity: '/icons/Snowflake_ICON_Workloads_Cybersecurity.svg',
  workload_data_apps: '/icons/Snowflake_ICON_Workloads_Data_Applications.svg',
  workload_data_eng: '/icons/Snowflake_ICON_Workloads_Data_Engeneering.svg',
  workload_data_lake: '/icons/Snowflake_ICON_Workloads_Data_Lake.svg',
  workload_data_warehouse: '/icons/Snowflake_ICON_Workloads_Data_Warehouse.svg',
  workload_unistore: '/icons/Snowflake_ICON_Workloads_Unistore.svg',
  
  // ===== ANALYTICS & DATA =====
  analytics: '/icons/Snowflake_ICON_Analytics.svg',
  data_analytics: '/icons/Snowflake_ICON_Data_Analytics.svg',
  data_engineering: '/icons/Snowflake_ICON_Data_Engineering.svg',
  embedded_analytics: '/icons/Snowflake_ICON_Embedded_Analytics.svg',
  geospatial: '/icons/Snowflake_ICON_Geospatial_Analytics.svg',
  accelerated_analytics: '/icons/Snowflake_ICON_Accelerated_Analytics.svg',
  
  // ===== INDUSTRY VERTICALS (40+ industries) =====
  industry_advertising: '/icons/Snowflake_ICON_Industry_Advertising.svg',
  industry_automotive: '/icons/Snowflake_ICON_Industry_Automotive.svg',
  industry_banking: '/icons/Snowflake_ICON_Industry_Banking.svg',
  industry_cpg: '/icons/Snowflake_ICON_Industry_CPG.svg',
  industry_data_providers: '/icons/Snowflake_ICON_Industry_Data_Providers.svg',
  industry_digital_health: '/icons/Snowflake_ICON_Industry_Digital_Health.svg',
  industry_ecommerce: '/icons/Snowflake_ICON_Industry_Ecommerce.svg',
  industry_education_higher: '/icons/Snowflake_ICON_Industry_Education_Higher.svg',
  industry_education_k12: '/icons/Snowflake_ICON_Industry_Education_K-12.svg',
  industry_federal: '/icons/Snowflake_ICON_Industry_Federal.svg',
  industry_fintech: '/icons/Snowflake_ICON_Industry_Fin_Tech.svg',
  industry_financial_services: '/icons/Snowflake_ICON_Industry_Financial_Services.svg',
  industry_gaming: '/icons/Snowflake_ICON_Industry_Gaming.svg',
  industry_healthcare: '/icons/Snowflake_ICON_Industry_Healthcare.svg',
  industry_insurance: '/icons/Snowflake_ICON_Industry_Insurance .svg',
  industry_life_sciences: '/icons/Snowflake_ICON_Industry_Life_Sciences.svg',
  industry_manufacturing: '/icons/Snowflake_ICON_Industry_Manufacturing.svg',
  industry_media: '/icons/Snowflake_ICON_Industry_Media_Publishers.svg',
  industry_pharma: '/icons/Snowflake_ICON_Industry_Pharma.svg',
  industry_public_sector: '/icons/Snowflake_ICON_Industry_Public_Sector.svg',
  industry_retail: '/icons/Snowflake_ICON_Industry_Retail.svg',
  industry_software: '/icons/Snowflake_ICON_Industry_Software.svg',
  industry_technology: '/icons/Snowflake_ICON_Industry_Technology.svg',
  industry_telecom: '/icons/Snowflake_ICON_Industry_Telecommunications.svg',
  industry_transport: '/icons/Snowflake_ICON_Industry_Transport.svg',
  
  // ===== SECURITY & GOVERNANCE CONCEPTS =====
  security: '/icons/Snowflake_ICON_Security.svg',
  security_governance: '/icons/Snowflake_ICON_Security_Governance.svg',
  secure_data: '/icons/Snowflake_ICON_Secure_Data.svg',
  horizon: '/icons/Snowflake_ICON_Horizon.svg',
  access: '/icons/Snowflake_ICON_Access.svg',
  trusted: '/icons/Snowflake_ICON_Trusted.svg',
  integrity: '/icons/Snowflake_ICON_Integrity.svg',
  
  // ===== PLATFORM & ARCHITECTURE =====
  architecture: '/icons/Snowflake_ICON_Architecture.svg',
  platform: '/icons/Snowflake_ICON_Platform.svg',
  storage_compute: '/icons/Snowflake_ICON_Storage_&_Compute.svg',
  server: '/icons/Snowflake_ICON_Server.svg',
  servers: '/icons/Snowflake_ICON_Servers.svg',
  desktop: '/icons/Snowflake_ICON_Desktop.svg',
  laptop: '/icons/Snowflake_ICON_Laptop.svg',
  mobile: '/icons/Snowflake_ICON_Mobile.svg',
  
  // ===== OPERATIONS & MANAGEMENT =====
  management: '/icons/Snowflake_ICON_Management.svg',
  optimization: '/icons/Snowflake_ICON_Optimization.svg',
  optimize: '/icons/Snowflake_ICON_Optimize.svg',
  performance_scale: '/icons/Snowflake_ICON_Performance_Scale.svg',
  scale: '/icons/Snowflake_ICON_Scale.svg',
  elasticity: '/icons/Snowflake_ICON_Instant_Elasticity.svg',
  concurrency: '/icons/Snowflake_ICON_Concurrency.svg',
  capacity: '/icons/Snowflake_ICON_Capacity.svg',
  backup: '/icons/Snowflake_ICON_Backup.svg',
  refresh: '/icons/Snowflake_ICON_Refresh.svg',
  
  // ===== BUSINESS & DATA CONCEPTS =====
  data_monetization: '/icons/Snowflake_ICON_Data_Monetization.svg',
  cost_savings: '/icons/Snowflake_ICON_Cost_Savings.svg',
  profit: '/icons/Snowflake_ICON_Profit.svg',
  results: '/icons/Snowflake_ICON_Results.svg',
  faster_insights: '/icons/Snowflake_ICON_Faster_Insights.svg',
  single_source_truth: '/icons/Snowflake_ICON_Single_Source_Truth.svg',
  all_your_data: '/icons/Snowflake_ICON_ALL_Your_Data.svg',
  integrated_data: '/icons/Snowflake_ICON_Integrated_Data.svg',
  
  // ===== DEVELOPMENT & CODE =====
  code: '/icons/Snowflake_ICON_Code.svg',
  sql: '/icons/Snowflake_ICON_SQL.svg',
  javascript: '/icons/Snowflake_ICON_Javascript.svg',
  dev: '/icons/Snowflake_ICON_Dev.svg',
  tools: '/icons/Snowflake_ICON_Tools.svg',
  
  // ===== UTILITIES & MISC =====
  calendar: '/icons/Snowflake_ICON_Calendar.svg',
  time: '/icons/Snowflake_ICON_Time.svg',
  email: '/icons/Snowflake_ICON_Email.svg',
  location: '/icons/Snowflake_ICON_Location.svg',
  world: '/icons/Snowflake_ICON_World.svg',
  flag: '/icons/Snowflake_ICON_Flag.svg',
  check: '/icons/Snowflake_ICON_Check.svg',
  information: '/icons/Snowflake_ICON_Information.svg',
  search: '/icons/Snowflake_ICON_Search.svg',
  web_search: '/icons/Snowflake_ICON_Web_Search.svg',
  target: '/icons/Snowflake_ICON_Target.svg',
  idea: '/icons/Snowflake_ICON_Idea.svg',
  launch: '/icons/Snowflake_ICON_Launch.svg',
  process: '/icons/Snowflake_ICON_Process.svg',
  connected: '/icons/Snowflake_ICON_Connected.svg',
  consolidate: '/icons/Snowflake_ICON_Consolidate.svg',
  transactions: '/icons/Snowflake_ICON_Transactions.svg',
  metadata: '/icons/Snowflake_ICON_Metadata.svg',
  log: '/icons/Snowflake_ICON_Log.svg',
  tlog: '/icons/Snowflake_ICON_TLOG.svg',
  
  // ===== DOCUMENTS & FILES =====
  documentation: '/icons/Snowflake_ICON_Documentation.svg',
  spreadsheet: '/icons/Snowflake_ICON_Spreadsheet_1.svg',
  csv_doc: '/icons/Snowflake_ICON_CSV.svg',
  json_doc: '/icons/Snowflake_ICON_JSON.svg',
  xml_doc: '/icons/Snowflake_ICON_XML.svg',
  xls_doc: '/icons/Snowflake_ICON_XLS.svg',
  blog: '/icons/Snowflake_ICON_Blog.svg',
  case_study: '/icons/Snowflake_ICON_Case_Study.svg',
  data_sheet: '/icons/Snowflake_ICON_Data_Sheet.svg',
  
  // ===== VIDEO & MULTIMEDIA =====
  video: '/icons/Snowflake_ICON_Video.svg',
  multimedia: '/icons/Snowflake_ICON_Mulitmedia.svg',
  webinar: '/icons/Snowflake_ICON_Webinar.svg',
  play: '/icons/Snowflake_ICON_Play.svg',
  
  // ===== SPECIAL TABLES & FEATURES =====
  dynamic_tables: '/icons/Snowflake_ICON_Dynamic_Tables.svg',
  external_tables: '/icons/Snowflake_ICON_External_Tables.svg',
  hybrid_tables: '/icons/Snowflake_ICON_Hybrid_Tables.svg',
  iceberg_tables: '/icons/Snowflake_ICON_Iceberg_Tables.svg',

  // ===== ACCOUNT BOUNDARIES / PERIMETERS =====
  account_boundary_snowflake: boundarySvg('#29B5E8'),
  account_boundary_aws: boundarySvg('#FF9900'),
  account_boundary_azure: boundarySvg('#0089D6'),
  account_boundary_gcp: boundarySvg('#4285F4'),
};

// Component categories - Organized by use case
export const COMPONENT_CATEGORIES = {
  'Core Objects': [
    { id: 'database', name: 'Database', icon: SNOWFLAKE_ICONS.database },
    { id: 'schema', name: 'Schema', icon: SNOWFLAKE_ICONS.schema },
    { id: 'table', name: 'Table', icon: SNOWFLAKE_ICONS.table },
    { id: 'view', name: 'View', icon: SNOWFLAKE_ICONS.view },
    { id: 'warehouse', name: 'Warehouse', icon: SNOWFLAKE_ICONS.warehouse },
    { id: 'task', name: 'Task', icon: SNOWFLAKE_ICONS.task },
    { id: 'stream', name: 'Stream', icon: SNOWFLAKE_ICONS.stream },
    { id: 'snowpipe', name: 'Snowpipe', icon: SNOWFLAKE_ICONS.snowpipe },
  ],
  
  'Warehouses': [
    { id: 'warehouse', name: 'Virtual WH', icon: SNOWFLAKE_ICONS.warehouse },
    { id: 'warehouse_snowpark', name: 'Snowpark WH', icon: SNOWFLAKE_ICONS.warehouse_snowpark },
    { id: 'warehouse_data', name: 'Data WH', icon: SNOWFLAKE_ICONS.warehouse_data },
    { id: 'warehouse_adaptive', name: 'Adaptive WH', icon: SNOWFLAKE_ICONS.warehouse_adaptive },
    { id: 'warehouse_gen2', name: 'Gen2 WH', icon: SNOWFLAKE_ICONS.warehouse_gen2 },
  ],
  
  'Tables': [
    { id: 'table', name: 'Table', icon: SNOWFLAKE_ICONS.table },
    { id: 'dynamic_table', name: 'Dynamic', icon: SNOWFLAKE_ICONS.dynamic_table },
    { id: 'iceberg_table', name: 'Iceberg', icon: SNOWFLAKE_ICONS.iceberg_table },
    { id: 'hybrid_table', name: 'Hybrid', icon: SNOWFLAKE_ICONS.hybrid_table },
    { id: 'external_table', name: 'External', icon: SNOWFLAKE_ICONS.external_table },
    { id: 'directory_table', name: 'Directory', icon: SNOWFLAKE_ICONS.directory_table },
  ],
  
  'Views': [
    { id: 'view', name: 'View', icon: SNOWFLAKE_ICONS.view },
    { id: 'materialized_view', name: 'Materialized', icon: SNOWFLAKE_ICONS.materialized_view },
    { id: 'secure_view', name: 'Secure', icon: SNOWFLAKE_ICONS.secure_view },
  ],
  
  'Functions': [
    { id: 'stored_proc', name: 'Stored Proc', icon: SNOWFLAKE_ICONS.stored_proc },
    { id: 'function', name: 'Function', icon: SNOWFLAKE_ICONS.function },
    { id: 'udf', name: 'UDF (SQL)', icon: SNOWFLAKE_ICONS.udf },
    { id: 'udf_java', name: 'UDF (Java)', icon: SNOWFLAKE_ICONS.udf_java },
    { id: 'udf_javascript', name: 'UDF (JS)', icon: SNOWFLAKE_ICONS.udf_javascript },
    { id: 'external_function', name: 'External Fn', icon: SNOWFLAKE_ICONS.external_function },
    { id: 'aggregate_function', name: 'Aggregate', icon: SNOWFLAKE_ICONS.aggregate_function },
    { id: 'window_function', name: 'Window', icon: SNOWFLAKE_ICONS.window_function },
  ],
  
  'Data Sources': [
    { id: 'external_stage', name: 'External Stage', icon: SNOWFLAKE_ICONS.external_stage },
    { id: 'internal_stage', name: 'Internal Stage', icon: SNOWFLAKE_ICONS.internal_stage },
    { id: 's3', name: 'S3', icon: SNOWFLAKE_ICONS.s3 },
    { id: 'kafka', name: 'Kafka', icon: SNOWFLAKE_ICONS.kafka },
    { id: 'hadoop', name: 'Hadoop', icon: SNOWFLAKE_ICONS.hadoop },
    { id: 'spark_connect', name: 'Spark', icon: SNOWFLAKE_ICONS.spark_connect },
    { id: 'iot', name: 'IoT', icon: SNOWFLAKE_ICONS.iot },
    { id: 'api', name: 'API', icon: SNOWFLAKE_ICONS.api },
  ],
  
  'ML & AI': [
    { id: 'cortex', name: 'Cortex', icon: SNOWFLAKE_ICONS.cortex },
    { id: 'cortex_search', name: 'Cortex Search', icon: SNOWFLAKE_ICONS.cortex_search },
    { id: 'cortex_analyst', name: 'Cortex Analyst', icon: SNOWFLAKE_ICONS.cortex_analyst },
    { id: 'ml_model', name: 'ML Model', icon: SNOWFLAKE_ICONS.ml_model },
    { id: 'notebook', name: 'Notebook', icon: SNOWFLAKE_ICONS.notebook },
    { id: 'document_ai', name: 'Document AI', icon: SNOWFLAKE_ICONS.document_ai },
    { id: 'ai_star', name: 'AI', icon: SNOWFLAKE_ICONS.ai_star },
  ],
  
  'Apps': [
    { id: 'snowpark_container', name: 'SPCS', icon: SNOWFLAKE_ICONS.snowpark_container },
    { id: 'streamlit', name: 'Streamlit', icon: SNOWFLAKE_ICONS.streamlit },
    { id: 'native_app', name: 'Native App', icon: SNOWFLAKE_ICONS.native_app },
    { id: 'web_app', name: 'Web App', icon: SNOWFLAKE_ICONS.web_app },
    { id: 'application', name: 'Application', icon: SNOWFLAKE_ICONS.application },
    { id: 'marketplace', name: 'Marketplace', icon: SNOWFLAKE_ICONS.marketplace },
  ],
  
  'Workloads': [
    { id: 'workload_ai', name: 'AI & ML', icon: SNOWFLAKE_ICONS.workload_ai },
    { id: 'workload_data_warehouse', name: 'Data Warehouse', icon: SNOWFLAKE_ICONS.workload_data_warehouse },
    { id: 'workload_data_lake', name: 'Data Lake', icon: SNOWFLAKE_ICONS.workload_data_lake },
    { id: 'workload_data_eng', name: 'Data Engineering', icon: SNOWFLAKE_ICONS.workload_data_eng },
    { id: 'workload_data_apps', name: 'Data Apps', icon: SNOWFLAKE_ICONS.workload_data_apps },
    { id: 'workload_cybersecurity', name: 'Cybersecurity', icon: SNOWFLAKE_ICONS.workload_cybersecurity },
    { id: 'workload_unistore', name: 'Unistore', icon: SNOWFLAKE_ICONS.workload_unistore },
  ],
  
  'Analytics': [
    { id: 'analytics', name: 'Analytics', icon: SNOWFLAKE_ICONS.analytics },
    { id: 'data_analytics', name: 'Data Analytics', icon: SNOWFLAKE_ICONS.data_analytics },
    { id: 'data_engineering', name: 'Data Engineering', icon: SNOWFLAKE_ICONS.data_engineering },
    { id: 'embedded_analytics', name: 'Embedded', icon: SNOWFLAKE_ICONS.embedded_analytics },
    { id: 'geospatial', name: 'Geospatial', icon: SNOWFLAKE_ICONS.geospatial },
    { id: 'accelerated_analytics', name: 'Accelerated', icon: SNOWFLAKE_ICONS.accelerated_analytics },
  ],
  
  'Data Sharing': [
    { id: 'share', name: 'Data Share', icon: SNOWFLAKE_ICONS.share },
    { id: 'private_exchange', name: 'Private Exchange', icon: SNOWFLAKE_ICONS.private_exchange },
    { id: 'public_exchange', name: 'Public Exchange', icon: SNOWFLAKE_ICONS.public_exchange },
    { id: 'notification', name: 'Notification', icon: SNOWFLAKE_ICONS.notification },
  ],

  'Account Boundary': [
    { id: 'account_boundary_snowflake', name: 'Snowflake Account', icon: SNOWFLAKE_ICONS.account_boundary_snowflake },
    { id: 'account_boundary_aws', name: 'AWS Account', icon: SNOWFLAKE_ICONS.account_boundary_aws },
    { id: 'account_boundary_azure', name: 'Azure Subscription', icon: SNOWFLAKE_ICONS.account_boundary_azure },
    { id: 'account_boundary_gcp', name: 'GCP Project', icon: SNOWFLAKE_ICONS.account_boundary_gcp },
  ],
  
  'Security - Policies': [
    { id: 'policy', name: 'Policy', icon: SNOWFLAKE_ICONS.policy },
    { id: 'policy_masking', name: 'Masking', icon: SNOWFLAKE_ICONS.policy_masking },
    { id: 'policy_row', name: 'Row Access', icon: SNOWFLAKE_ICONS.policy_row },
    { id: 'policy_network', name: 'Network', icon: SNOWFLAKE_ICONS.policy_network },
    { id: 'policy_session', name: 'Session', icon: SNOWFLAKE_ICONS.policy_session },
    { id: 'security', name: 'Security', icon: SNOWFLAKE_ICONS.security },
    { id: 'horizon', name: 'Horizon', icon: SNOWFLAKE_ICONS.horizon },
  ],
  
  'Security - Roles': [
    { id: 'role', name: 'Role', icon: SNOWFLAKE_ICONS.role },
    { id: 'role_accountadmin', name: 'ACCOUNTADMIN', icon: SNOWFLAKE_ICONS.role_accountadmin },
    { id: 'role_securityadmin', name: 'SECURITYADMIN', icon: SNOWFLAKE_ICONS.role_securityadmin },
    { id: 'role_sysadmin', name: 'SYSADMIN', icon: SNOWFLAKE_ICONS.role_sysadmin },
    { id: 'role_useradmin', name: 'USERADMIN', icon: SNOWFLAKE_ICONS.role_useradmin },
    { id: 'role_orgadmin', name: 'ORGADMIN', icon: SNOWFLAKE_ICONS.role_orgadmin },
    { id: 'role_public', name: 'PUBLIC', icon: SNOWFLAKE_ICONS.role_public },
  ],
  
  'Users & Access': [
    { id: 'user', name: 'User', icon: SNOWFLAKE_ICONS.user },
    { id: 'users', name: 'Users', icon: SNOWFLAKE_ICONS.users },
    { id: 'users_multiple', name: 'Users (Multi)', icon: SNOWFLAKE_ICONS.users_multiple },
    { id: 'access', name: 'Access', icon: SNOWFLAKE_ICONS.access },
    { id: 'tag', name: 'Tag', icon: SNOWFLAKE_ICONS.tag },
  ],
  
  'DR & Replication': [
    { id: 'failover_group', name: 'Failover Group', icon: SNOWFLAKE_ICONS.failover_group },
    { id: 'failover_group_ds', name: 'FG (Data Science)', icon: SNOWFLAKE_ICONS.failover_group_ds },
    { id: 'failover_group_finance', name: 'FG (Finance)', icon: SNOWFLAKE_ICONS.failover_group_finance },
    { id: 'failover_group_it', name: 'FG (IT)', icon: SNOWFLAKE_ICONS.failover_group_it },
    { id: 'failover_group_sales', name: 'FG (Sales)', icon: SNOWFLAKE_ICONS.failover_group_sales },
    { id: 'backup', name: 'Backup', icon: SNOWFLAKE_ICONS.backup },
  ],
  
  'File Formats': [
    { id: 'file', name: 'File', icon: SNOWFLAKE_ICONS.file },
    { id: 'file_csv', name: 'CSV', icon: SNOWFLAKE_ICONS.file_csv },
    { id: 'file_json', name: 'JSON', icon: SNOWFLAKE_ICONS.file_json },
    { id: 'file_parquet', name: 'Parquet', icon: SNOWFLAKE_ICONS.file_parquet },
    { id: 'file_avro', name: 'Avro', icon: SNOWFLAKE_ICONS.file_avro },
    { id: 'file_xml', name: 'XML', icon: SNOWFLAKE_ICONS.file_xml },
    { id: 'file_text', name: 'Text', icon: SNOWFLAKE_ICONS.file_text },
    { id: 'file_excel', name: 'Excel', icon: SNOWFLAKE_ICONS.file_excel },
  ],
  
  'Data Types': [
    { id: 'data', name: 'Data', icon: SNOWFLAKE_ICONS.data },
    { id: 'structured_data', name: 'Structured', icon: SNOWFLAKE_ICONS.structured_data },
    { id: 'semi_structured_data', name: 'Semi-Structured', icon: SNOWFLAKE_ICONS.semi_structured_data },
    { id: 'unstructured_data', name: 'Unstructured', icon: SNOWFLAKE_ICONS.unstructured_data },
    { id: 'file_image', name: 'Image', icon: SNOWFLAKE_ICONS.file_image },
    { id: 'file_video', name: 'Video', icon: SNOWFLAKE_ICONS.file_video },
    { id: 'file_audio', name: 'Audio', icon: SNOWFLAKE_ICONS.file_audio },
  ],
  
  'Industries': [
    { id: 'industry_financial_services', name: 'Financial Services', icon: SNOWFLAKE_ICONS.industry_financial_services },
    { id: 'industry_healthcare', name: 'Healthcare', icon: SNOWFLAKE_ICONS.industry_healthcare },
    { id: 'industry_retail', name: 'Retail', icon: SNOWFLAKE_ICONS.industry_retail },
    { id: 'industry_manufacturing', name: 'Manufacturing', icon: SNOWFLAKE_ICONS.industry_manufacturing },
    { id: 'industry_technology', name: 'Technology', icon: SNOWFLAKE_ICONS.industry_technology },
    { id: 'industry_telecom', name: 'Telecom', icon: SNOWFLAKE_ICONS.industry_telecom },
    { id: 'industry_banking', name: 'Banking', icon: SNOWFLAKE_ICONS.industry_banking },
    { id: 'industry_insurance', name: 'Insurance', icon: SNOWFLAKE_ICONS.industry_insurance },
    { id: 'industry_pharma', name: 'Pharma', icon: SNOWFLAKE_ICONS.industry_pharma },
    { id: 'industry_life_sciences', name: 'Life Sciences', icon: SNOWFLAKE_ICONS.industry_life_sciences },
    { id: 'industry_ecommerce', name: 'E-Commerce', icon: SNOWFLAKE_ICONS.industry_ecommerce },
    { id: 'industry_media', name: 'Media', icon: SNOWFLAKE_ICONS.industry_media },
    { id: 'industry_gaming', name: 'Gaming', icon: SNOWFLAKE_ICONS.industry_gaming },
    { id: 'industry_advertising', name: 'Advertising', icon: SNOWFLAKE_ICONS.industry_advertising },
    { id: 'industry_automotive', name: 'Automotive', icon: SNOWFLAKE_ICONS.industry_automotive },
    { id: 'industry_education_higher', name: 'Higher Ed', icon: SNOWFLAKE_ICONS.industry_education_higher },
    { id: 'industry_public_sector', name: 'Public Sector', icon: SNOWFLAKE_ICONS.industry_public_sector },
    { id: 'industry_federal', name: 'Federal', icon: SNOWFLAKE_ICONS.industry_federal },
  ],
  
  'Platform': [
    { id: 'architecture', name: 'Architecture', icon: SNOWFLAKE_ICONS.architecture },
    { id: 'platform', name: 'Platform', icon: SNOWFLAKE_ICONS.platform },
    { id: 'storage_compute', name: 'Storage & Compute', icon: SNOWFLAKE_ICONS.storage_compute },
    { id: 'server', name: 'Server', icon: SNOWFLAKE_ICONS.server },
    { id: 'cloud', name: 'Cloud', icon: SNOWFLAKE_ICONS.s3 },
  ],
  
  'Operations': [
    { id: 'optimization', name: 'Optimization', icon: SNOWFLAKE_ICONS.optimization },
    { id: 'performance_scale', name: 'Performance', icon: SNOWFLAKE_ICONS.performance_scale },
    { id: 'management', name: 'Management', icon: SNOWFLAKE_ICONS.management },
    { id: 'elasticity', name: 'Elasticity', icon: SNOWFLAKE_ICONS.elasticity },
    { id: 'concurrency', name: 'Concurrency', icon: SNOWFLAKE_ICONS.concurrency },
    { id: 'refresh', name: 'Refresh', icon: SNOWFLAKE_ICONS.refresh },
  ],
  
  'Business Value': [
    { id: 'cost_savings', name: 'Cost Savings', icon: SNOWFLAKE_ICONS.cost_savings },
    { id: 'faster_insights', name: 'Faster Insights', icon: SNOWFLAKE_ICONS.faster_insights },
    { id: 'data_monetization', name: 'Data Monetization', icon: SNOWFLAKE_ICONS.data_monetization },
    { id: 'single_source_truth', name: 'Single Source of Truth', icon: SNOWFLAKE_ICONS.single_source_truth },
    { id: 'results', name: 'Results', icon: SNOWFLAKE_ICONS.results },
  ],
  
  'Development': [
    { id: 'code', name: 'Code', icon: SNOWFLAKE_ICONS.code },
    { id: 'sql', name: 'SQL', icon: SNOWFLAKE_ICONS.sql },
    { id: 'javascript', name: 'JavaScript', icon: SNOWFLAKE_ICONS.javascript },
    { id: 'dev', name: 'Dev', icon: SNOWFLAKE_ICONS.dev },
    { id: 'tools', name: 'Tools', icon: SNOWFLAKE_ICONS.tools },
  ],
  
  'Utilities': [
    { id: 'calendar', name: 'Calendar', icon: SNOWFLAKE_ICONS.calendar },
    { id: 'time', name: 'Time', icon: SNOWFLAKE_ICONS.time },
    { id: 'email', name: 'Email', icon: SNOWFLAKE_ICONS.email },
    { id: 'location', name: 'Location', icon: SNOWFLAKE_ICONS.location },
    { id: 'world', name: 'World', icon: SNOWFLAKE_ICONS.world },
    { id: 'check', name: 'Check', icon: SNOWFLAKE_ICONS.check },
    { id: 'search', name: 'Search', icon: SNOWFLAKE_ICONS.search },
    { id: 'idea', name: 'Idea', icon: SNOWFLAKE_ICONS.idea },
    { id: 'target', name: 'Target', icon: SNOWFLAKE_ICONS.target },
    { id: 'connected', name: 'Connected', icon: SNOWFLAKE_ICONS.connected },
  ],
};

export default SNOWFLAKE_ICONS;
