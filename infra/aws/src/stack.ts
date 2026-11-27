// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-FileCopyrightText: Copyright 2026 Smart Hospital Platform contributors
// SPDX-License-Identifier: Apache-2.0
// Adapted from Medplum's AWS CDK infrastructure patterns; see docs/architecture/UPSTREAM.md.

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  aws_certificatemanager as acm,
  aws_cloudwatch as cloudwatch,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_elasticache as elasticache,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_rds as rds,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SmartHospitalInfraConfig } from './types';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(sourceDir, '../../..');

export class SmartHospitalInfraStack extends Stack {
  constructor(scope: Construct, config: SmartHospitalInfraConfig) {
    super(scope, config.stackName, {
      env: { account: config.account, region: config.region },
      description: `Smart Hospital ${config.environment} foundation, adapted from Medplum AWS CDK patterns`,
    });

    const appDomainName = `${config.appSubdomain}.${config.hostedZoneName}`;
    const apiDomainName = `${config.apiSubdomain}.${config.hostedZoneName}`;
    const appBaseUrl = `https://${appDomainName}/`;
    const apiBaseUrl = `https://${apiDomainName}/`;

    Tags.of(this).add('project', 'smart-hospital-platform');
    Tags.of(this).add('environment', config.environment);

    const vpcFlowLogs = new logs.LogGroup(this, 'VpcFlowLogs', {
      logGroupName: `/smart-hospital/${config.environment}/vpc-flow-logs`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      availabilityZones: config.availabilityZones,
      natGateways: 1,
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Application', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'Data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.addFlowLog('FlowLogs', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(vpcFlowLogs),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, clusterName: `${config.stackName}-cluster` });
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc,
      description: 'PostgreSQL access from the Smart Hospital API tasks only',
      allowAllOutbound: false,
    });
    const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSecurityGroup', {
      vpc,
      description: 'Redis access from the Smart Hospital API tasks only',
      allowAllOutbound: false,
    });

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_9 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      databaseName: 'smart_hospital',
      credentials: rds.Credentials.fromGeneratedSecret('medplum'),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: false,
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: false,
      deletionProtection: true,
      copyTagsToSnapshot: true,
      cloudwatchLogsExports: ['postgresql'],
      autoMinorVersionUpgrade: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const databaseSecret = database.secret;
    if (!databaseSecret) {
      throw new Error('CDK did not create a database credentials secret');
    }
    databaseSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const adminSecret = new secretsmanager.Secret(this, 'BootstrapAdminSecret', {
      description: `Generated bootstrap super-admin password for ${config.environment}`,
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'password',
        passwordLength: 40,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'Private isolated subnets for Smart Hospital Redis',
      subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
    });
    const cacheSecret = new secretsmanager.Secret(this, 'CacheSecret', {
      description: 'Generated Redis AUTH token for Smart Hospital staging',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'password',
        passwordLength: 40,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const cache = new elasticache.CfnReplicationGroup(this, 'Cache', {
      replicationGroupDescription: `Smart Hospital ${config.environment} Redis cache`,
      cacheNodeType: 'cache.t4g.micro',
      engine: 'redis',
      engineVersion: '7.1',
      numCacheClusters: 1,
      port: 6379,
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      securityGroupIds: [cacheSecurityGroup.securityGroupId],
      authToken: cacheSecret.secretValueFromJson('password').toString(),
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      snapshotRetentionLimit: 1,
      snapshotWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
    });
    cache.applyRemovalPolicy(RemovalPolicy.RETAIN);

    const storageBucket = new s3.Bucket(this, 'BinaryStorageBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      cors: [
        {
          allowedOrigins: [`https://${appDomainName}`],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: Duration.hours(1).toSeconds(),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      vpc,
      description: 'Public HTTPS entry point for the web app and FHIR API',
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Redirect HTTP to HTTPS');
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc,
      description: 'Web container traffic from the load balancer only',
    });
    const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc,
      description: 'API container traffic from the load balancer only',
    });
    webSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(8080));
    apiSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(8103));
    databaseSecurityGroup.addIngressRule(apiSecurityGroup, ec2.Port.tcp(5432));
    cacheSecurityGroup.addIngressRule(apiSecurityGroup, ec2.Port.tcp(6379));

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', config.certificateArn);
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSecurityGroup,
      dropInvalidHeaderFields: true,
    });

    const webTargetGroup = new elbv2.ApplicationTargetGroup(this, 'WebTargetGroup', {
      vpc,
      targetType: elbv2.TargetType.IP,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 8080,
      healthCheck: { path: '/healthcheck', healthyHttpCodes: '200' },
    });
    const apiTargetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargetGroup', {
      vpc,
      targetType: elbv2.TargetType.IP,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 8103,
      healthCheck: { path: '/healthcheck', healthyHttpCodes: '200' },
    });

    loadBalancer.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
    });
    const httpsListener = loadBalancer.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultTargetGroups: [webTargetGroup],
    });
    httpsListener.addTargetGroups('ApiHostRule', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.hostHeaders([apiDomainName])],
      targetGroups: [apiTargetGroup],
    });

    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/smart-hospital/${config.environment}/api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const webLogGroup = new logs.LogGroup(this, 'WebLogGroup', {
      logGroupName: `/smart-hospital/${config.environment}/web`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', { cpu: 512, memoryLimitMiB: 1024 });
    storageBucket.grantReadWrite(apiTask.taskRole, 'binary/*');
    storageBucket.grantDelete(apiTask.taskRole, 'binary/*');
    const apiContainer = apiTask.addContainer('ApiContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(
        new ecrAssets.DockerImageAsset(this, 'ApiImage', {
          directory: projectRoot,
          file: 'Dockerfile',
          target: 'server',
          platform: ecrAssets.Platform.LINUX_AMD64,
        })
      ),
      logging: ecs.LogDrivers.awsLogs({ logGroup: apiLogGroup, streamPrefix: 'api' }),
      environment: {
        MEDPLUM_BASE_URL: apiBaseUrl,
        MEDPLUM_APP_BASE_URL: appBaseUrl,
        MEDPLUM_STORAGE_BASE_URL: `https://${storageBucket.bucketRegionalDomainName}/binary/`,
        MEDPLUM_BINARY_STORAGE: `s3:${storageBucket.bucketName}`,
        MEDPLUM_PORT: '8103',
        MEDPLUM_DATABASE_HOST: database.dbInstanceEndpointAddress,
        MEDPLUM_DATABASE_PORT: database.dbInstanceEndpointPort,
        MEDPLUM_DATABASE_DBNAME: 'smart_hospital',
        MEDPLUM_DATABASE_USERNAME: 'medplum',
        MEDPLUM_DATABASE_SSL_REQUIRE: 'true',
        MEDPLUM_REDIS_HOST: cache.attrPrimaryEndPointAddress,
        MEDPLUM_REDIS_PORT: '6379',
        MEDPLUM_REDIS_TLS: '{}',
        MEDPLUM_AWS_REGION: config.region,
        MEDPLUM_DEFAULT_SUPER_ADMIN_EMAIL: config.adminEmail,
      },
      secrets: {
        MEDPLUM_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
        MEDPLUM_REDIS_PASSWORD: ecs.Secret.fromSecretsManager(cacheSecret, 'password'),
        MEDPLUM_DEFAULT_SUPER_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminSecret, 'password'),
      },
      essential: true,
      healthCheck: {
        command: [
          'CMD-SHELL',
          `node -e "fetch('http://127.0.0.1:8103/healthcheck').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"`,
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(90),
      },
    });
    apiContainer.addPortMappings({ containerPort: 8103, protocol: ecs.Protocol.TCP });

    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', { cpu: 256, memoryLimitMiB: 512 });
    const webContainer = webTask.addContainer('WebContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(
        new ecrAssets.DockerImageAsset(this, 'WebImage', {
          directory: projectRoot,
          file: 'Dockerfile',
          target: 'web',
          buildArgs: { VITE_MEDPLUM_BASE_URL: apiBaseUrl },
          platform: ecrAssets.Platform.LINUX_AMD64,
        })
      ),
      logging: ecs.LogDrivers.awsLogs({ logGroup: webLogGroup, streamPrefix: 'web' }),
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:8080/healthcheck'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });
    webContainer.addPortMappings({ containerPort: 8080, protocol: ecs.Protocol.TCP });

    const apiService = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: apiTask,
      desiredCount: config.desiredCount,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      securityGroups: [apiSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthCheckGracePeriod: Duration.seconds(120),
      circuitBreaker: { rollback: true },
    });
    const webService = new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      desiredCount: config.desiredCount,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      securityGroups: [webSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthCheckGracePeriod: Duration.seconds(60),
      circuitBreaker: { rollback: true },
    });
    apiTargetGroup.addTarget(apiService);
    webTargetGroup.addTarget(webService);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.hostedZoneName,
    });
    for (const subdomain of [config.appSubdomain, config.apiSubdomain]) {
      new route53.ARecord(this, `${subdomain}Alias`, {
        zone,
        recordName: subdomain,
        target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(loadBalancer)),
      });
    }

    new cloudwatch.Alarm(this, 'ApiTargetHealthAlarm', {
      alarmDescription: 'Alarm when no API tasks are healthy behind the load balancer',
      metric: apiTargetGroup.metrics.healthyHostCount({ period: Duration.minutes(1) }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    new CfnOutput(this, 'AppUrl', { value: appBaseUrl });
    new CfnOutput(this, 'ApiUrl', { value: apiBaseUrl });
    new CfnOutput(this, 'LoadBalancerDnsName', { value: loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, 'DatabaseEndpoint', { value: database.dbInstanceEndpointAddress });
    new CfnOutput(this, 'RedisEndpoint', { value: cache.attrPrimaryEndPointAddress });
    new CfnOutput(this, 'BinaryStorageBucketName', { value: storageBucket.bucketName });
    new CfnOutput(this, 'DatabaseSecretArn', { value: databaseSecret.secretArn });
    new CfnOutput(this, 'RedisSecretArn', { value: cacheSecret.secretArn });
    new CfnOutput(this, 'BootstrapAdminSecretArn', { value: adminSecret.secretArn });
  }
}
