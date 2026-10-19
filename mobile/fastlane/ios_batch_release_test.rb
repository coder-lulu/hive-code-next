require "minitest/autorun"
require "ostruct"
require_relative "ios_batch_release"

class IosBatchReleaseTest < Minitest::Test
  def test_frozen_identity_and_apple_conflicts
    config = {"expo" => {"version" => "1.5.0-beta.27", "ios" => {"buildNumber" => "28"}}}
    assert_raises(RuntimeError) { IosBatchRelease.prepare(config: config, product_version: "1.5.0-beta.27", build_number: "28", latest_build: 28) }
    assert_raises(RuntimeError) { IosBatchRelease.prepare(config: config, product_version: "1.5.0-beta.28", build_number: "28", latest_build: 27) }
    result = IosBatchRelease.prepare(config: config, product_version: "1.5.0-beta.27", build_number: "28", latest_build: 27)
    assert_equal "1.5.0", result["expo"]["version"]
    assert_equal "28", result["expo"]["ios"]["buildNumber"]
  end

  def setup
    @url = "https://testflight.apple.com/join/abc123"
    @build = OpenStruct.new(id: "build", app_version: "1.5.0", version: "28", processing_state: "VALID", expired: false,
      build_beta_detail: OpenStruct.new(external_build_state: "IN_BETA_TESTING"))
    @group = OpenStruct.new(name: "HiveCode Beta", is_internal_group: false, public_link_enabled: true, public_link: @url, fetch_builds: [@build])
    @app = OpenStruct.new(id: "123", get_beta_groups: [@group])
  end

  def verify(channel = "beta", url = @url)
    IosBatchRelease.verify!(app: @app, build: @build, version: "1.5.0", build_number: "28", channel: channel, store_url: url, groups: ["HiveCode Beta"])
  end

  def test_beta_exact_available_build
    assert verify
    @build.build_beta_detail.external_build_state = "WAITING_FOR_BETA_REVIEW"
    assert_raises(RuntimeError) { verify }
  end

  def test_public_link_must_distribute_exact_build
    @group.fetch_builds = []
    assert_raises(RuntimeError) { verify }
    @group.fetch_builds = [@build]
    @group.public_link_enabled = false
    assert_raises(RuntimeError) { verify }
  end

  def test_stable_must_be_live_with_exact_build
    version = OpenStruct.new(platform: "IOS", version_string: "1.5.0", app_version_state: "READY_FOR_DISTRIBUTION", downloadable: true, get_build: @build)
    @app.get_app_store_versions = [version]
    @build.expired = true # TestFlight expiry does not withdraw an App Store version.
    assert verify("stable", "https://apps.apple.com/app/id123")
    version.get_build = OpenStruct.new(id: "other")
    assert_raises(RuntimeError) { verify("stable", "https://apps.apple.com/app/id123") }
    version.get_build = @build
    version.app_version_state = "WAITING_FOR_REVIEW"
    assert_raises(RuntimeError) { verify("stable", "https://apps.apple.com/app/id123") }
  end
end
