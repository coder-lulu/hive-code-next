require "uri"

# Fail closed: an uploaded or approved binary is not necessarily downloadable.
module IosBatchRelease
  module_function

  def prepare(config:, product_version:, build_number:, latest_build:)
    raise "Committed mobile version differs from batch" unless config.fetch("expo").fetch("version") == product_version
    raise "Invalid product version" unless product_version.match?(/\A\d+\.\d+\.\d+(?:-beta\.\d+)?\z/)
    raise "Invalid reserved build number" unless build_number.match?(/\A[1-9]\d*\z/)
    raise "Committed iOS build differs from reservation" unless config.fetch("expo").fetch("ios").fetch("buildNumber") == build_number
    raise "Reserved iOS build already used by Apple; commit a higher build number" unless latest_build.to_i < build_number.to_i
    config.fetch("expo")["version"] = product_version.split("-").first
    config
  end

  def verify!(app:, build:, version:, build_number:, channel:, store_url:, groups:)
    raise "Exact Apple build is not available" unless build && build.app_version == version && build.version == build_number && build.processing_state == "VALID"
    url = URI.parse(store_url)
    raise "Invalid Apple store URL" unless url.scheme == "https" && url.userinfo.nil? && url.query.nil? && url.fragment.nil? && url.port == 443
    if channel == "beta"
      raise "TestFlight build has expired" unless build.expired == false
      raise "TestFlight build is pending external distribution" unless build.build_beta_detail&.external_build_state == "IN_BETA_TESTING"
      raise "Invalid TestFlight URL" unless url.host == "testflight.apple.com" && url.path.match?(%r{\A/join/[A-Za-z0-9]+\z})
      matching = app.get_beta_groups.select { |g| groups.include?(g.name) && g.is_internal_group == false && g.public_link_enabled == true && g.public_link == store_url }
      raise "Public TestFlight group does not distribute this build" unless matching.any? { |g| g.fetch_builds.any? { |b| b.id == build.id } }
    elsif channel == "stable"
      raise "Invalid App Store URL" unless url.host == "apps.apple.com" && url.path.match?(%r{/id#{Regexp.escape(app.id)}\z})
      released = app.get_app_store_versions.select do |v|
        state = v.respond_to?(:app_version_state) && v.app_version_state || v.app_store_state
        v.platform == "IOS" && v.version_string == version && %w[READY_FOR_DISTRIBUTION READY_FOR_SALE].include?(state) && v.downloadable == true
      end
      raise "App Store version is pending distribution or points to another build" unless released.any? { |v| v.get_build&.id == build.id }
    else
      raise "Unsupported iOS batch channel"
    end
    true
  end
end
